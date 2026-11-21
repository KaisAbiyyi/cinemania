import { describe, expect, it } from "vitest";
import {
  buildSafeMatchShare,
  isRetryAllowed,
  matchRevealKey,
  newerResult,
  parseResultPayload,
} from "@/components/cinematch/result/resultModel";

const roomId = "7e1249e6-a564-45c8-91fb-1a1dada1bd12";
const roundId = "f99371e1-d5c8-4e1a-adb6-6c6ac7653f6b";
const candidate = {
  candidateId: "c1",
  movieId: 27205,
  position: 0,
  title: "Inception",
  releaseDate: "2010-07-16",
  posterPath: null,
  posterUrl: null,
  overview: "A dream within a dream.",
  voteAverage: 8.2,
};

function matchPayload(version = 10) {
  return {
    room: {
      roomId,
      status: "MATCHED",
      stateVersion: version,
      currentRoundId: roundId,
      matchedMovieId: candidate.movieId,
      matchedCandidate: { ...candidate },
      finishState: {
        code: "MATCH_FOUND",
        matchedMovieId: candidate.movieId,
        retryAvailable: false,
      },
    },
    viewer: { role: "MEMBER", participantId: "private-member-id" },
  };
}

function exhaustedPayload(role: "HOST" | "MEMBER" = "HOST") {
  return {
    room: {
      roomId,
      status: "EXHAUSTED",
      stateVersion: 11,
      currentRoundId: roundId,
      matchedMovieId: null,
      matchedCandidate: null,
      canRetry: true,
      finishState: {
        code: "DECK_EXHAUSTED",
        matchedMovieId: null,
        retryAvailable: true,
      },
    },
    viewer: { role, canRetry: role === "HOST" },
  };
}

describe("CINE-025 authoritative room outcome", () => {
  it("accepts committed unanimous result, never client-generated match", () => {
    const payload = parseResultPayload(matchPayload(), roomId);
    expect(payload?.room.matchedMovieId).toBe(27205);
    expect(payload && matchRevealKey(payload.room)).toBe(
      `${roomId}:${roundId}:27205`
    );
    expect(parseResultPayload({ ...matchPayload(), room: { ...matchPayload().room, status: "ACTIVE" } }, roomId)?.room.status).toBe("ACTIVE");
  });

  it("fails closed for wrong room, missing identity or mismatched committed movie", () => {
    expect(parseResultPayload(matchPayload(), "another-room")).toBeNull();
    const wrong = matchPayload();
    wrong.room.matchedCandidate.movieId = 999;
    expect(parseResultPayload(wrong, roomId)).toBeNull();
    expect(parseResultPayload({ ...matchPayload(), viewer: { role: "UNKNOWN" } }, roomId)).toBeNull();
    const fake = matchPayload();
    fake.room.finishState.matchedMovieId = 999;
    expect(parseResultPayload(fake, roomId)).toBeNull();
  });

  it("does not regress stateVersion on duplicate, delayed or replayed snapshots", () => {
    const fresh = parseResultPayload(matchPayload(11), roomId)!;
    const stale = parseResultPayload(matchPayload(9), roomId)!;
    const duplicate = parseResultPayload(matchPayload(11), roomId)!;
    expect(newerResult(fresh, stale)).toBe(fresh);
    expect(newerResult(fresh, duplicate)).toBe(fresh);
    const future = parseResultPayload(matchPayload(12), roomId)!;
    expect(newerResult(fresh, future)).toBe(future);
  });

  it("guards retry behind authoritative exhausted state, host and quorum", () => {
    const host = parseResultPayload(exhaustedPayload(), roomId)!;
    expect(isRetryAllowed(host)).toBe(true);
    expect(isRetryAllowed(parseResultPayload(exhaustedPayload("MEMBER"), roomId)!)).toBe(false);
    expect(isRetryAllowed({
      ...host,
      room: { ...host.room, canRetry: false },
    })).toBe(false);
    expect(isRetryAllowed({
      ...host,
      room: { ...host.room, status: "ACTIVE" },
    })).toBe(false);
  });

  it("shares only allowlisted title and year, never guest tokens or room fields", () => {
    const original = {
      ...candidate,
      participantToken: "SECRET_PARTICIPANT_CAPABILITY",
      roomId: "PRIVATE_ROOM_ID",
      invitePath: "/private-room",
      streamingProvider: "not-verified",
    };
    const text = buildSafeMatchShare(original);
    expect(text).toBe("CineMatch Movie Night: Inception (2010)");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("PRIVATE_ROOM");
    expect(text).not.toContain("streamingProvider");
    expect(buildSafeMatchShare({ title: "Line\nBreak\tFilm", releaseDate: "unknown" }))
      .toBe("CineMatch Movie Night: Line Break Film");
  });

  it("does not invent a reveal without a committed matched round", () => {
    const exhausted = parseResultPayload(exhaustedPayload(), roomId)!;
    expect(matchRevealKey(exhausted.room)).toBeNull();
  });
});
