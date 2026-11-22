// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  REDACTION_INIT_SCRIPT,
  REDACTION_SELECTORS,
  clientsMissingHint,
  decodeRealtimeFrame,
  peersMissingSnapshot,
  roomChangedVersion,
  summarizeConvergence,
  type RealtimeTrace,
} from "../e2e/helpers/cine026a-realtime-evidence";

const ROOM = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** Binary kind-4 broadcast frame, the encoding Supabase Realtime uses for server broadcasts. */
function binaryBroadcast(topic: string, event: string, body: unknown): Buffer {
  const topicBytes = Buffer.from(topic);
  const eventBytes = Buffer.from(event);
  return Buffer.concat([Buffer.from([4, topicBytes.length, eventBytes.length, 0, 1]), topicBytes, eventBytes, Buffer.from(JSON.stringify(body))]);
}

describe("room_changed frame decoding", () => {
  it("reads the authoritative version from a binary broadcast for exactly this room", () => {
    expect(roomChangedVersion(binaryBroadcast(`realtime:room:${ROOM}`, "room_changed", { roomId: ROOM, version: 8 }), ROOM)).toBe(8);
  });

  it("reads the JSON array encoding as well", () => {
    const frame = JSON.stringify([null, null, `realtime:room:${ROOM}`, "broadcast", { event: "room_changed", payload: { roomId: ROOM, version: 5 } }]);
    expect(roomChangedVersion(frame, ROOM)).toBe(5);
  });

  it("ignores another room, other events, malformed versions and non-JSON frames", () => {
    expect(roomChangedVersion(binaryBroadcast("t", "room_changed", { roomId: OTHER, version: 8 }), ROOM)).toBeNull();
    expect(roomChangedVersion(binaryBroadcast("t", "presence_state", { roomId: ROOM, version: 8 }), ROOM)).toBeNull();
    expect(roomChangedVersion(binaryBroadcast("t", "room_changed", { roomId: ROOM, version: "8" }), ROOM)).toBeNull();
    expect(roomChangedVersion(binaryBroadcast("t", "room_changed", { roomId: ROOM, version: -1 }), ROOM)).toBeNull();
    expect(roomChangedVersion("not json", ROOM)).toBeNull();
  });

  it("decodes heartbeat-style JSON objects without throwing", () => {
    expect(decodeRealtimeFrame(JSON.stringify({ event: "phx_reply", payload: { status: "ok" } }))).toMatchObject({ event: "phx_reply" });
  });
});

const trace = (hints: Array<[number, number]>, snapshots: Array<[number, number, number]>): RealtimeTrace => ({
  hints: hints.map(([version, at]) => ({ version, at })),
  snapshots: snapshots.map(([version, startedAt, at]) => ({ version, startedAt, at })),
});

describe("convergence evidence", () => {
  const anchor = 10_000;

  it("attributes convergence to the private WebSocket when the exact-version frame precedes the snapshot GET", () => {
    const evidence = summarizeConvergence(trace([[8, anchor - 300]], [[8, anchor + 100, anchor + 900]]), 8, anchor, anchor + 950);
    expect(evidence).toMatchObject({
      hintDelivered: true, snapshotReadAtVersion: true, snapshotStartedAfterHint: true,
      hintAfterAnchorMs: -300, snapshotStartAfterAnchorMs: 100, snapshotDoneAfterAnchorMs: 900, renderedAfterAnchorMs: 950,
      hintToSnapshotStartMs: 400, snapshotDoneToRenderMs: 50, evidencePath: "private-websocket-hint",
    });
  });

  it("does not let a poll-healed UI pass as event-path convergence: rendered, snapshot read, but no frame", () => {
    const evidence = summarizeConvergence(trace([[6, anchor - 5000], [7, anchor - 4000]], [[8, anchor + 14_000, anchor + 14_300]]), 8, anchor, anchor + 14_400);
    expect(evidence.hintDelivered).toBe(false);
    expect(evidence.evidencePath).toBe("no-hint-poll-or-forced-resync");
    expect(clientsMissingHint([evidence])).toEqual([0]);
  });

  it("requires the EXPECTED version: earlier hints, and a hint for a different version, are not delivery", () => {
    expect(summarizeConvergence(trace([[7, anchor]], []), 8, anchor, null).hintDelivered).toBe(false);
    expect(summarizeConvergence(trace([[9, anchor]], []), 8, anchor, null).hintDelivered).toBe(false);
  });

  it("flags a snapshot that began before the frame (poll or forced resync) instead of calling it hint-triggered", () => {
    const evidence = summarizeConvergence(trace([[8, anchor + 500]], [[8, anchor + 100, anchor + 400]]), 8, anchor, anchor + 450);
    expect(evidence.snapshotStartedAfterHint).toBe(false);
    expect(evidence.hintDelivered).toBe(true);
  });

  it("reports a never-converged client with null latencies", () => {
    const evidence = summarizeConvergence(trace([], []), 8, anchor, null);
    expect(evidence).toMatchObject({ hintDelivered: false, snapshotReadAtVersion: false, renderedAfterAnchorMs: null, evidencePath: "not-converged" });
  });

  it("lists clients without the hint and peers without a snapshot, excluding the final voter from the snapshot rule", () => {
    const ok = summarizeConvergence(trace([[8, 1]], [[8, 2, 3]]), 8, 0, 4);
    const noHint = summarizeConvergence(trace([], [[8, 2, 3]]), 8, 0, 4);
    const voterWithoutGet = summarizeConvergence(trace([[8, 1]], []), 8, 0, 4);
    const peerWithoutGet = summarizeConvergence(trace([[8, 1]], []), 8, 0, 4);
    expect(clientsMissingHint([ok, noHint, voterWithoutGet])).toEqual([1]);
    expect(peersMissingSnapshot([ok, noHint, voterWithoutGet], 2)).toEqual([]);
    expect(peersMissingSnapshot([ok, noHint, peerWithoutGet], 0)).toEqual([2]);
  });
});

describe("redaction init script", () => {
  it("is plain JavaScript that parses, is guarded against throwing, and observes `document`", () => {
    expect(() => new Function(REDACTION_INIT_SCRIPT)).not.toThrow();
    expect(REDACTION_INIT_SCRIPT).toContain("try {");
    expect(REDACTION_INIT_SCRIPT).toContain(".observe(document,");
    expect(REDACTION_INIT_SCRIPT).not.toContain("documentElement");
    for (const selector of REDACTION_SELECTORS) expect(REDACTION_INIT_SCRIPT).toContain(JSON.stringify(selector).slice(1, -1).replace(/\\"/g, '\\"'));
  });

  it("never throws when the document is not ready (observe target missing) and records the problem instead", () => {
    const errors: string[] = [];
    const fakeWindow: Record<string, unknown> = {};
    const run = new Function("window", "document", "MutationObserver", REDACTION_INIT_SCRIPT);
    // A document whose observe() throws, like observing a null documentElement did.
    const document = { head: null, getElementById: () => null, createElement: () => ({}) };
    class ThrowingObserver { constructor(_: () => void) { void _; } observe() { throw new TypeError("not of type Node"); } }
    expect(() => run(fakeWindow, document, ThrowingObserver)).not.toThrow();
    errors.push(String(fakeWindow.__cmRedactionError));
    expect(errors[0]).toContain("not of type Node");
  });

  it("injects the blur style once the head exists, and only once", () => {
    const appended: Array<{ id: string; textContent: string }> = [];
    let callback: (() => void) | undefined;
    const head = { append: (node: { id: string; textContent: string }) => { appended.push(node); } };
    const document = {
      head: null as unknown,
      getElementById: (id: string) => appended.find((node) => node.id === id) ?? null,
      createElement: () => ({ id: "", textContent: "" }),
    };
    class Observer { constructor(cb: () => void) { callback = cb; } observe() { /* captured */ } }
    new Function("window", "document", "MutationObserver", REDACTION_INIT_SCRIPT)({}, document, Observer);
    expect(appended).toHaveLength(0); // head absent at bootstrap: nothing to inject yet, and no throw
    document.head = head;
    callback!();
    callback!();
    expect(appended).toHaveLength(1);
    expect(appended[0]!.textContent).toContain("blur(10px)");
    expect(appended[0]!.textContent).toContain("cm-room-code");
    expect(appended[0]!.textContent).toContain("cine024-voting-panel");
  });
});
