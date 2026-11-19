import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getRoomAuthorityStore, getRoomRateLimitPool } from "@/lib/server/room/roomStore";
import {
  CapabilityAuthError,
  extractCookieValue,
  getCapabilitySecret,
  getGuestCookieName,
  isValidUuid,
  verifyGuestCapabilityToken,
} from "./guestCapability";

const WINDOW_SECONDS = 60;
const LIMITS = {
  create: { network: 20, guest: 20 },
  join: { network: 30, guest: 30 },
  vote: { network: 60, guest: 60 },
  "realtime-token": { network: 24, guest: 12 },
} as const;
type Operation = keyof typeof LIMITS;
type Bucket = { count: number; expiresAt: number };
const offlineBuckets = new WeakMap<object, Map<string, Bucket>>();

export class RoomRateLimitError extends Error {
  constructor(public readonly retryAfter: number) {
    super("Room request limit reached. Retry after the indicated delay.");
  }
}

function networkIdentity(request: Request): string {
  // Vercel overwrites this header at ingress. Other hosts use a shared fallback
  // bucket until they have an equivalent trusted source.
  const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.trim() : undefined;
  if (!ip) return "shared";
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6 || ip.includes("%")) return "shared";

  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  const [head, tail] = canonical.split("::");
  const first = head ? head.split(":") : [];
  const last = tail ? tail.split(":") : [];
  const expanded = tail === undefined ? first : [...first, ...Array(8 - first.length - last.length).fill("0"), ...last];
  return `${expanded.slice(0, 4).join(":")}::/64`;
}

function guestIdentity(request: Request, roomId: string | undefined, secret: string): string | undefined {
  if (!roomId || !isValidUuid(roomId)) return;
  const normalized = roomId.toLowerCase();
  const token = extractCookieValue(request.headers.get("cookie"), getGuestCookieName(normalized));
  if (!token) return;
  try {
    // Bucket assignment uses a signature-verified identity. The handler still
    // enforces DB membership and current generation before granting authority.
    const { pid } = verifyGuestCapabilityToken(token, { expectedRoomId: normalized, secret });
    return `${normalized}:${pid}`;
  } catch (error) {
    if (!(error instanceof CapabilityAuthError)) throw error;
  }
}

export async function enforceRoomRateLimit(request: Request, operation: Operation, roomId?: string): Promise<void> {
  const secret = getCapabilitySecret();
  const guest = guestIdentity(request, roomId, secret);
  const identity = guest ? `guest:${guest}` : `network:${networkIdentity(request)}`;
  const limit = LIMITS[operation][guest ? "guest" : "network"];
  const key = createHmac("sha256", secret).update(`cinematch-rate-limit:v1:${operation}:${identity}`).digest("hex");
  const store = getRoomAuthorityStore();
  const pool = getRoomRateLimitPool(store);

  if (pool) {
    try {
      const { rows } = await pool.query<{ allowed: boolean; retry_after: number }>(
        `WITH request_time AS (SELECT clock_timestamp() AS ts),
         expired AS (
           DELETE FROM cinematch_private.room_request_limits WHERE bucket_key IN (
             SELECT bucket_key FROM cinematch_private.room_request_limits
             WHERE expires_at <= (SELECT ts FROM request_time) AND bucket_key <> $1
             ORDER BY expires_at LIMIT 32 FOR UPDATE SKIP LOCKED
           )
         ),
         counted AS (
           INSERT INTO cinematch_private.room_request_limits AS bucket (bucket_key, hit_count, expires_at)
           SELECT $1, 1, ts + make_interval(secs => $2) FROM request_time
           ON CONFLICT (bucket_key) DO UPDATE
           SET hit_count = CASE WHEN bucket.expires_at <= (SELECT ts FROM request_time) THEN 1
                                ELSE LEAST(bucket.hit_count + 1, $3::integer + 1) END,
               expires_at = CASE WHEN bucket.expires_at <= (SELECT ts FROM request_time)
                                 THEN excluded.expires_at ELSE bucket.expires_at END
           RETURNING hit_count, expires_at
         )
         SELECT hit_count <= $3::integer AS allowed,
                GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - clock_timestamp())))::integer AS retry_after
         FROM counted`,
        [key, WINDOW_SECONDS, limit],
      );
      if (!rows[0].allowed) throw new RoomRateLimitError(rows[0].retry_after);
    } catch (error) {
      if (error instanceof RoomRateLimitError) throw error;
      console.error("[CINEMATCH_RATE_LIMIT_UNAVAILABLE] Check migration 006 and room database access.");
      throw new CapabilityAuthError(503, "RATE_LIMIT_UNAVAILABLE", "Room request validation is temporarily unavailable.");
    }
    return;
  }

  // The authority store permits SQLite only in development or the explicit offline harness.
  let buckets = offlineBuckets.get(store);
  if (!buckets) {
    buckets = new Map();
    offlineBuckets.set(store, buckets);
  }
  const now = Date.now();
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(bucketKey);
  }
  const bucket = buckets.get(key) ?? { count: 0, expiresAt: now + WINDOW_SECONDS * 1000 };
  if (bucket.count >= limit) throw new RoomRateLimitError(Math.ceil((bucket.expiresAt - now) / 1000));
  bucket.count++;
  buckets.set(key, bucket);
}
