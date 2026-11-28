/**
 * CINE-026-A — pure (browser-free) evidence helpers for the hosted CINE-026 qualification.
 *
 * Nothing here imports Playwright, so the decoding and classification rules are covered by deterministic unit
 * tests (tests/unit/cine026a-realtime-evidence.test.ts). Nothing here records tokens, cookies, room ids, room
 * codes or participant identifiers: a frame is reduced to (version, arrival time) before it is stored.
 */

export interface RealtimeFrame {
  topic?: string;
  event?: string;
  payload?: {
    event?: string;
    status?: string;
    response?: Record<string, unknown>;
    roomId?: string;
    version?: number;
    payload?: { roomId?: string; version?: number };
  };
}

/** Decodes a Supabase Realtime frame (JSON array/object text, or binary kind-4 broadcast). */
export function decodeRealtimeFrame(message: string | Uint8Array): RealtimeFrame | null {
  if (typeof message === "string") {
    const decoded = JSON.parse(message) as unknown;
    if (Array.isArray(decoded) && decoded.length >= 5) {
      return { topic: String(decoded[2]), event: String(decoded[3]), payload: decoded[4] as RealtimeFrame["payload"] };
    }
    return decoded as RealtimeFrame;
  }
  const bytes = Buffer.from(message);
  // Supabase Realtime encodes server broadcast frames as binary (kind 4).
  // Read only the length-prefixed event name; no room IDs or payload data are logged.
  if (bytes.length >= 5 && bytes[0] === 4) {
    const topicLength = bytes[1]!;
    const eventLength = bytes[2]!;
    const metadataLength = bytes[3]!;
    const payloadEncoding = bytes[4]!;
    const topic = bytes.subarray(5, 5 + topicLength).toString("utf8");
    const eventStart = 5 + topicLength;
    const event = bytes.subarray(eventStart, eventStart + eventLength).toString("utf8");
    const payloadStart = eventStart + eventLength + metadataLength;
    let body: { roomId?: string; version?: number } | undefined;
    if (payloadEncoding === 1) {
      try { body = JSON.parse(bytes.subarray(payloadStart).toString("utf8")) as { roomId?: string; version?: number }; }
      catch { /* Ignore malformed or non-JSON frames in this test observer. */ }
    }
    return { topic, event: "broadcast", payload: { event, payload: body } };
  }
  const decoded = JSON.parse(bytes.toString("utf8")) as unknown;
  if (Array.isArray(decoded) && decoded.length >= 5) {
    return { topic: String(decoded[2]), event: String(decoded[3]), payload: decoded[4] as RealtimeFrame["payload"] };
  }
  return decoded as RealtimeFrame;
}

/** The authoritative stateVersion of a `room_changed` broadcast for exactly this room, else null. */
export function roomChangedVersion(message: string | Uint8Array, roomId: string): number | null {
  let frame: RealtimeFrame | null;
  try { frame = decodeRealtimeFrame(message); } catch { return null; }
  const hint = frame?.payload?.payload ?? frame?.payload;
  if (frame?.event !== "broadcast" || frame.payload?.event !== "room_changed") return null;
  if (hint?.roomId !== roomId || !Number.isSafeInteger(hint.version) || hint.version! < 0) return null;
  return hint.version!;
}

export interface HintObservation { version: number; at: number }
export interface SnapshotObservation { version: number; startedAt: number; at: number }
export interface RealtimeTrace { hints: HintObservation[]; snapshots: SnapshotObservation[] }

export interface ConvergenceEvidence {
  /** A private `room_changed` frame carrying exactly the expected version reached this client. */
  hintDelivered: boolean;
  /** An authoritative snapshot GET at or above the expected version completed on this client. */
  snapshotReadAtVersion: boolean;
  /** The first such GET began after the first matching frame (hint-triggered), false when it began before it. */
  snapshotStartedAfterHint: boolean | null;
  /** All values are milliseconds relative to `anchorAt` (the voter's response), or null when it never happened. */
  hintAfterAnchorMs: number | null;
  snapshotStartAfterAnchorMs: number | null;
  snapshotDoneAfterAnchorMs: number | null;
  renderedAfterAnchorMs: number | null;
  hintToSnapshotStartMs: number | null;
  snapshotDoneToRenderMs: number | null;
  /** How the UI could have learned the state: only a frame proves the event path. */
  evidencePath: "private-websocket-hint" | "no-hint-poll-or-forced-resync" | "not-converged";
}

const rel = (at: number | null | undefined, anchorAt: number) => (at === null || at === undefined ? null : at - anchorAt);

/**
 * Correlates, for ONE client, frame arrival, the snapshot GET and the rendered card progression.
 * `renderedAt` is null when the UI never converged. The decision is pure so poll-vs-event mistakes are testable.
 */
export function summarizeConvergence(trace: RealtimeTrace, expectedVersion: number, anchorAt: number, renderedAt: number | null): ConvergenceEvidence {
  const hint = trace.hints.find((observation) => observation.version === expectedVersion) ?? null;
  const snapshot = trace.snapshots.find((observation) => observation.version >= expectedVersion) ?? null;
  const hintDelivered = hint !== null;
  return {
    hintDelivered,
    snapshotReadAtVersion: snapshot !== null,
    snapshotStartedAfterHint: hint && snapshot ? snapshot.startedAt >= hint.at : null,
    hintAfterAnchorMs: rel(hint?.at, anchorAt),
    snapshotStartAfterAnchorMs: rel(snapshot?.startedAt, anchorAt),
    snapshotDoneAfterAnchorMs: rel(snapshot?.at, anchorAt),
    renderedAfterAnchorMs: rel(renderedAt, anchorAt),
    hintToSnapshotStartMs: hint && snapshot ? snapshot.startedAt - hint.at : null,
    snapshotDoneToRenderMs: snapshot && renderedAt !== null ? renderedAt - snapshot.at : null,
    evidencePath: renderedAt === null ? "not-converged" : hintDelivered ? "private-websocket-hint" : "no-hint-poll-or-forced-resync",
  };
}

/** Clients (by index) that did NOT receive the expected-version private hint. Polling can never satisfy this. */
export function clientsMissingHint(evidence: ConvergenceEvidence[]): number[] {
  return evidence.flatMap((entry, index) => (entry.hintDelivered ? [] : [index]));
}

/** Peers (every client except the final voter, whose view comes from the vote response) that never read the snapshot. */
export function peersMissingSnapshot(evidence: ConvergenceEvidence[], finalVoterIndex: number): number[] {
  return evidence.flatMap((entry, index) => (index === finalVoterIndex || entry.snapshotReadAtVersion ? [] : [index]));
}

/**
 * CSS selectors that show a room code (lobby chip and the voting header). Videos of hosted failures retain
 * them only if this style is active before the sensitive UI is first painted.
 */
export const REDACTION_SELECTORS = ['[data-testid="cm-room-code"]', '[data-testid="cine024-voting-panel"] header p'];
export const REDACTION_STYLE_ID = "cine026-video-redaction";

/**
 * Plain-JS init script. The whole body is guarded: WebKit evaluates every init script as one bootstrap, so any
 * exception here would silently disable every later init script (the cause of the earlier same-page BLOCKED).
 * `document` is observed because `document.documentElement` is null when init scripts run.
 */
export const REDACTION_INIT_SCRIPT = `(() => {
  try {
    const apply = () => {
      if (!document.head || document.getElementById(${JSON.stringify(REDACTION_STYLE_ID)})) return;
      const style = document.createElement("style");
      style.id = ${JSON.stringify(REDACTION_STYLE_ID)};
      style.textContent = ${JSON.stringify(REDACTION_SELECTORS.join(", ") + " { filter: blur(10px) !important; }")};
      document.head.append(style);
    };
    new MutationObserver(apply).observe(document, { childList: true, subtree: true });
    apply();
  } catch (error) {
    window.__cmRedactionError = String(error && error.message ? error.message : error);
  }
})();`;
