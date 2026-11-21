import type { SafeDeckCandidate } from "@/lib/schemas/roomDeck";
import type {
  SafeRoomSnapshot,
  RoomSessionViewer,
} from "@/lib/server/room/roomSnapshot";

/**
 * The only source of truth for a CineMatch result is the authenticated room
 * snapshot. Never compute a match from client votes or realtime hints.
 */
export interface ResultPayload {
  room: SafeRoomSnapshot;
  viewer: RoomSessionViewer;
}

const VALID_STATUSES = new Set([
  "LOBBY", "ACTIVE", "MATCHED", "EXHAUSTED", "EXPIRED",
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseResultPayload(
  response: unknown,
  expectedRoomId: string
): ResultPayload | null {
  if (!record(response) || !record(response.room) || !record(response.viewer)) {
    return null;
  }

  const room = response.room;
  const viewer = response.viewer;
  if (
    room.roomId !== expectedRoomId ||
    !VALID_STATUSES.has(String(room.status)) ||
    typeof room.stateVersion !== "number" ||
    !Number.isSafeInteger(room.stateVersion) ||
    room.stateVersion < 0 ||
    !record(room.finishState) ||
    typeof room.finishState.code !== "string" ||
    (viewer.role !== "HOST" && viewer.role !== "MEMBER")
  ) {
    return null;
  }

  // A result must be internally consistent with the server's committed state.
  if (room.status === "MATCHED") {
    if (
      room.finishState.code !== "MATCH_FOUND" ||
      !record(room.matchedCandidate) ||
      typeof room.matchedMovieId !== "number" ||
      room.matchedCandidate.movieId !== room.matchedMovieId ||
      room.finishState.matchedMovieId !== room.matchedMovieId ||
      typeof room.matchedCandidate.title !== "string" ||
      !room.matchedCandidate.title.trim()
    ) {
      return null;
    }
  }
  if (
    (room.status === "EXHAUSTED" && room.finishState.code !== "DECK_EXHAUSTED") ||
    (room.status === "EXPIRED" && room.finishState.code !== "ROOM_EXPIRED")
  ) {
    return null;
  }

  return response as unknown as ResultPayload;
}

/** Replayed, stale or reordered snapshots cannot roll the UI backwards. */
export function newerResult(
  previous: ResultPayload | null,
  next: ResultPayload
): ResultPayload {
  if (
    previous?.room.roomId === next.room.roomId &&
    next.room.stateVersion <= previous.room.stateVersion
  ) {
    return previous;
  }
  return next;
}

export function isRetryAllowed(payload: ResultPayload): boolean {
  return (
    payload.room.status === "EXHAUSTED" &&
    payload.room.finishState.code === "DECK_EXHAUSTED" &&
    payload.room.finishState.retryAvailable === true &&
    payload.room.canRetry === true &&
    payload.viewer.role === "HOST" &&
    payload.viewer.canRetry === true
  );
}

/** A committed round/movie ID identifies one reveal, not each incoming event. */
export function matchRevealKey(room: SafeRoomSnapshot): string | null {
  if (
    room.status !== "MATCHED" ||
    !room.currentRoundId ||
    !room.matchedCandidate ||
    room.matchedCandidate.movieId !== room.matchedMovieId
  ) {
    return null;
  }
  return `${room.roomId}:${room.currentRoundId}:${room.matchedMovieId}`;
}

/**
 * Explicit allowlist: no participant names, cookies, room codes, room IDs,
 * invite links, provider availability or client-held capability tokens.
 */
export function buildSafeMatchShare(
  candidate: Pick<SafeDeckCandidate, "title" | "releaseDate">
): string {
  const title = candidate.title
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const year = candidate.releaseDate?.match(/^\d{4}(?:-|$)/)?.[0].slice(0, 4);
  return `CineMatch Movie Night: ${title || "Untitled Film"}${year ? ` (${year})` : ""}`;
}
