import { describe, expect, it } from "vitest";
import { isRoomPayload, normalizeRoomCode, roomErrorMessage, RoomClientError } from "@/components/cinematch/room/clientApi";

describe("CINE-023 room entry client contract", () => {
  it("accepts only six-character code alphabet and normalizes documented invite links", () => {
    expect(normalizeRoomCode("cnm482")).toBe("CNM482");
    expect(normalizeRoomCode("cnm-482")).toBe("CNM482");
    expect(normalizeRoomCode("https://example.test/join/cnm482")).toBe("CNM482");
    expect(normalizeRoomCode("https://example.test/join/cnm482?ref=hello")).toBe("CNM482");
    expect(normalizeRoomCode("invalid")).toBeNull();
    expect(normalizeRoomCode("ABC123")).toBeNull(); // "1" excluded from unambiguous code alphabet
    expect(normalizeRoomCode("https://example.test/?token=secret")).toBeNull();
  });

  it("distinguishes not found, full, expired, and network failure", () => {
    expect(roomErrorMessage(new RoomClientError("ROOM_NOT_FOUND", "", 404))).toContain("not found");
    expect(roomErrorMessage(new RoomClientError("ROOM_FULL", "", 409))).toContain("full");
    expect(roomErrorMessage(new RoomClientError("ROOM_EXPIRED", "", 410))).toContain("expired");
    expect(roomErrorMessage(new RoomClientError("NETWORK_ERROR", "", 0))).toContain("connection");
  });

  it("rejects invalid server payloads rather than navigating to an unchecked URL", () => {
    expect(isRoomPayload({ room: { roomId: "javascript:alert(1)" }, viewer: { role: "HOST" } })).toBe(false);
    expect(isRoomPayload({ room: { roomId: "12345678-1234-1234-1234-123456789abc", stateVersion: 1, participants: [] }, viewer: { role: "MEMBER" } })).toBe(true);
    expect(isRoomPayload({ room: { roomId: "12345678-1234-1234-1234-123456789abc", stateVersion: 1, participants: [] }, viewer: { role: "UNTRUSTED" } })).toBe(false);
  });
});
