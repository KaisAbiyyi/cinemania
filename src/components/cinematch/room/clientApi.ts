import type { SafeRoomSnapshot, RoomSessionViewer } from "@/lib/server/room/roomSnapshot";

export interface RoomPayload {
  room: SafeRoomSnapshot;
  viewer: RoomSessionViewer;
}

export class RoomClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "RoomClientError";
  }
}

const ROOM_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

/** Accept codes (including spaced/hyphenated codes) or the documented /join/CODE link only. */
export function normalizeRoomCode(raw: string): string | null {
  const trimmed = raw.trim();
  const pathCode = trimmed.match(/(?:^|\/)join\/([a-zA-Z0-9 -]{6,12})(?:[/?#]|$)/i)?.[1];
  const candidate = (pathCode ?? trimmed).replace(/[\s-]/g, "").toUpperCase();
  return ROOM_CODE.test(candidate) ? candidate : null;
}

export function roomErrorMessage(error: RoomClientError): string {
  if (error.status === 404) return "Room not found. Check your invitation code and try again.";
  if (error.status === 410) return "This room has expired. Ask your host to create a new room.";
  if (error.code === "ROOM_FULL") return "This room is full (maximum five participants).";
  if (error.status === 429) return "Too many attempts. Please wait before trying again.";
  if (error.status === 401 || error.status === 403) return "Your room membership is no longer valid. Rejoin using the invitation link.";
  if (error.code === "INVALID_ROOM_CODE") return "Enter a valid six-character room code.";
  if (error.status === 0) return "Could not reach CineMatch. Check your connection and try again.";
  return error.message || "The request could not be completed. Please try again.";
}

export async function roomRequest<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new RoomClientError("NETWORK_ERROR", "Network request failed.", 0);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new RoomClientError("INVALID_RESPONSE", "Server returned an unreadable response.", response.status);
  }

  if (!response.ok) {
    const details = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new RoomClientError(
      typeof details.error === "string" ? details.error : "ROOM_REQUEST_FAILED",
      typeof details.message === "string" ? details.message : "Room request failed.",
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
    );
  }
  return data as T;
}

export function isRoomPayload(value: unknown): value is RoomPayload {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<RoomPayload>;
  return Boolean(
    data.room &&
    typeof data.room.roomId === "string" &&
    /^[a-f0-9-]{36}$/i.test(data.room.roomId) &&
    Number.isSafeInteger(data.room.stateVersion) &&
    Array.isArray(data.room.participants) &&
    data.viewer &&
    (data.viewer.role === "HOST" || data.viewer.role === "MEMBER")
  );
}
