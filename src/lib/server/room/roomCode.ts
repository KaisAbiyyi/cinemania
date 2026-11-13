import crypto from "node:crypto";
import { CapabilityAuthError } from "@/lib/server/auth/guestCapability";

/**
 * Unambiguous 32-character Crockford-style alphabet (omits 0, O, 1, I).
 * 32^6 = 1,073,741,824 possible 6-character codes; crypto.randomInt(0, 32) is uniform without modulo bias.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
export const DEFAULT_CODE_GENERATION_MAX_RETRIES = 5;

const STRICT_ROOM_CODE_REGEX = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export class RoomCodeGenerationError extends Error {
  public readonly status = 503;
  public readonly code = "ROOM_CODE_GENERATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "RoomCodeGenerationError";
    Object.setPrototypeOf(this, RoomCodeGenerationError.prototype);
  }
}

/**
 * Generates a cryptographically random 6-character uppercase room code.
 */
export function generateRoomCode(
  randomIntFn: (maxExclusive: number) => number = (max) => crypto.randomInt(0, max)
): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = randomIntFn(ROOM_CODE_ALPHABET.length);
    if (!Number.isInteger(index) || index < 0 || index >= ROOM_CODE_ALPHABET.length) {
      throw new RoomCodeGenerationError("Invalid random character index during room code generation.");
    }
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

/**
 * Extracts and normalizes a 6-character room code from raw text, hyphenated codes,
 * or invite links (`/join/CODE`, `/room?code=CODE`, `https://.../join/CODE`).
 * Ignores any URL token/secret parameters and never echoes untrusted input in errors.
 */
export function normalizeRoomCodeInput(rawInput: string): string {
  if (typeof rawInput !== "string") {
    throw new CapabilityAuthError(400, "INVALID_ROOM_CODE", "Room code or invite link must be a string.");
  }

  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 512) {
    throw new CapabilityAuthError(
      400,
      "INVALID_ROOM_CODE",
      "Room code must be 6 valid characters (letters A-Z excluding I/O, digits 2-9)."
    );
  }

  let extracted = trimmed;

  const looksLikeUrlOrPath =
    /^https?:\/\//i.test(trimmed) || trimmed.startsWith("/") || trimmed.includes("?") || trimmed.includes("/");
  if (looksLikeUrlOrPath) {
    try {
      const parsed = new URL(trimmed, "http://invite.local");
      const queryCode = parsed.searchParams.get("code") ?? parsed.searchParams.get("roomCode");
      if (queryCode && queryCode.trim().length > 0) {
        extracted = queryCode;
      } else {
        const segments = parsed.pathname
          .split("/")
          .map((segment) => {
            try {
              return decodeURIComponent(segment).trim();
            } catch {
              return segment.trim();
            }
          })
          .filter(Boolean);
        extracted = segments.length > 0 ? segments[segments.length - 1] : "";
      }
    } catch {
      throw new CapabilityAuthError(400, "INVALID_ROOM_CODE", "Invalid invite link or room code format.");
    }
  }

  const normalized = extracted.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!STRICT_ROOM_CODE_REGEX.test(normalized)) {
    throw new CapabilityAuthError(
      400,
      "INVALID_ROOM_CODE",
      "Room code must be 6 valid characters (letters A-Z excluding I/O, digits 2-9)."
    );
  }

  return normalized;
}

/**
 * Builds a shareable relative invite path without embedding any capability secret or session token.
 */
export function buildRoomInvitePath(code: string): string {
  return `/join/${normalizeRoomCodeInput(code)}`;
}
