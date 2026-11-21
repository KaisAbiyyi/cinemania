"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CineMatchVotingPanel, type VotingSnapshot } from "@/components/cinematch/voting/CineMatchVotingPanel";
import { CineMatchAlertCard } from "@/components/cinematch/CineMatchPrimitives";
import { createRoomActions } from "@/lib/realtime/roomActions";
import {
  startRoomRealtime,
  type RoomRealtimeHandle,
  type RoomSnapshot,
  type RealtimeStatus,
} from "@/lib/realtime/roomRealtime";
import type { SafeRoomSnapshot, RoomSessionViewer } from "@/lib/server/room/roomSnapshot";

const PUBLIC_REALTIME_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLIC_REALTIME_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const TERMINAL_HTTP = new Set([401, 403, 404, 410]);

export function isTerminalVotingAccessFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as { status?: unknown; permanent?: unknown; code?: unknown };
  return details.permanent === true ||
    (typeof details.status === "number" && TERMINAL_HTTP.has(details.status)) ||
    details.code === "UNAUTHORIZED";
}

function accessMessage(status: number | null): string {
  if (status === 410) return "This room has expired. Create or join a new room.";
  if (status === 404) return "This room was not found or is no longer available. Check your invitation.";
  if (status === 401 || status === 403) return "Your room membership is no longer authorized. Rejoin using a valid invitation.";
  return "Private room access is no longer available. Rejoin to verify your membership.";
}

function safeSnapshot(value: RoomSnapshot): VotingSnapshot | null {
  const room = value.room as unknown as SafeRoomSnapshot;
  const viewer = value.viewer as RoomSessionViewer | undefined;
  if (!room || !viewer || typeof room.stateVersion !== "number" ||
    !Number.isSafeInteger(room.stateVersion) || typeof room.roomId !== "string" ||
    typeof room.status !== "string" || !Array.isArray(room.participants) ||
    typeof viewer.isEligibleVoter !== "boolean") return null;
  return { room, viewer };
}

type AccessLoss = { status: number | null; message: string };

/**
 * CINE-024: private voting snapshots must be erased as soon as authorization is lost.
 * Epoch checks fence out-of-order GET, mutation and websocket results; no old transport
 * callback may restore a revoked viewer, room code, candidate or roster.
 */
export function CineMatchVotingClient({ roomId }: { roomId: string }) {
  const [snapshot, setSnapshot] = useState<VotingSnapshot | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessLoss, setAccessLoss] = useState<AccessLoss | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [sessionRevision, setSessionRevision] = useState(0);
  const currentRef = useRef<VotingSnapshot | null>(null);
  const realtimeRef = useRef<RoomRealtimeHandle | null>(null);
  const actionsRef = useRef<ReturnType<typeof createRoomActions> | null>(null);
  const epochRef = useRef(0);
  const revokedRef = useRef(false);
  const checkingRef = useRef(false);

  const revoke = useCallback((httpStatus: number | null, expectedEpoch: number) => {
    if (epochRef.current !== expectedEpoch || revokedRef.current) return;
    revokedRef.current = true;
    epochRef.current++;
    currentRef.current = null;
    actionsRef.current = null;
    setSnapshot(null);
    setStatus("closed");
    setError(null);
    setLoading(false);
    setAccessLoss({ status: httpStatus, message: accessMessage(httpStatus) });
    const handle = realtimeRef.current;
    realtimeRef.current = null;
    if (handle) void handle().catch(() => undefined);
  }, []);

  const accept = useCallback((value: RoomSnapshot, expectedEpoch: number): boolean => {
    if (revokedRef.current || epochRef.current !== expectedEpoch) return false;
    const next = safeSnapshot(value);
    if (!next || next.room.roomId !== roomId) return false;
    const previous = currentRef.current;
    if (previous && next.room.stateVersion < previous.room.stateVersion) return false;
    currentRef.current = next;
    setSnapshot(next);
    setError(null);
    return true;
  }, [roomId]);

  const fetchSnapshot = useCallback(async (expectedEpoch: number): Promise<VotingSnapshot> => {
    if (revokedRef.current || epochRef.current !== expectedEpoch) {
      throw new Error("Room authorization is no longer valid.");
    }
    const response = await fetch("/api/rooms/" + encodeURIComponent(roomId), {
      credentials: "same-origin",
      cache: "no-store",
    });
    // A concurrent revocation may have happened while the GET was in flight.
    if (revokedRef.current || epochRef.current !== expectedEpoch) {
      throw new Error("Discarded response from a revoked room session.");
    }
    if (!response.ok) {
      if (TERMINAL_HTTP.has(response.status)) {
        revoke(response.status, expectedEpoch);
        throw new Error(accessMessage(response.status));
      }
      throw new Error("Room snapshot refused (" + response.status + ").");
    }
    const value = await response.json() as RoomSnapshot;
    // JSON parsing may also take place after a permanent realtime auth failure.
    if (!accept(value, expectedEpoch)) {
      throw new Error("Server returned a stale, revoked or invalid room snapshot.");
    }
    const safe = safeSnapshot(value);
    if (!safe) throw new Error("Room snapshot was invalid.");
    return safe;
  }, [roomId, accept, revoke]);

  const resync = useCallback(async (): Promise<void> => {
    if (revokedRef.current) throw new Error("Room authorization is no longer valid.");
    const epoch = epochRef.current;
    if (realtimeRef.current) await realtimeRef.current.resync();
    else await fetchSnapshot(epoch);
    if (revokedRef.current || epochRef.current !== epoch) throw new Error("Room access was revoked.");
  }, [fetchSnapshot]);

  // An explicit new GET is required before clearing an HTTP 429 failed vote.
  const resyncWithSnapshot = useCallback(async (): Promise<VotingSnapshot> => {
    const epoch = epochRef.current;
    await resync();
    return fetchSnapshot(epoch);
  }, [resync, fetchSnapshot]);

  // Reauthorization is deliberately user-initiated. A socket status or old
  // broadcast is never enough to revive protected state.
  const retryAuthorization = useCallback(async () => {
    if (!revokedRef.current || checkingRef.current) return;
    checkingRef.current = true;
    setCheckingAccess(true);
    const epoch = epochRef.current;
    try {
      const response = await fetch("/api/rooms/" + encodeURIComponent(roomId), {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (epochRef.current !== epoch || !revokedRef.current) return;
      if (!response.ok) {
        setAccessLoss({ status: response.status, message: accessMessage(response.status) });
        return;
      }
      const value = await response.json() as RoomSnapshot;
      const verified = safeSnapshot(value);
      if (!verified || verified.room.roomId !== roomId ||
        epochRef.current !== epoch || !revokedRef.current) {
        throw new Error("The room session has not been verified.");
      }
      // Start a new realtime connection/action layer; previous callbacks still
      // belong to the invalidated epoch, even if they resolve after this GET.
      setAccessLoss(null);
      setSessionRevision((n) => n + 1);
    } catch {
      if (epochRef.current === epoch && revokedRef.current) {
        setAccessLoss({ status: null, message: "Could not verify room access. Rejoin using a valid invitation and try again." });
      }
    } finally {
      checkingRef.current = false;
      setCheckingAccess(false);
    }
  }, [roomId]);

  useEffect(() => {
    const syncNetwork = () => setOffline(!navigator.onLine);
    syncNetwork();
    window.addEventListener("online", syncNetwork);
    window.addEventListener("offline", syncNetwork);
    return () => {
      window.removeEventListener("online", syncNetwork);
      window.removeEventListener("offline", syncNetwork);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const epoch = ++epochRef.current;
    revokedRef.current = false;
    currentRef.current = null;
    setSnapshot(null);
    setError(null);
    setAccessLoss(null);
    setLoading(true);
    setStatus("connecting");

    const safeAccept = (value: RoomSnapshot) => !cancelled && accept(value, epoch);
    const safeResync = async () => {
      if (cancelled) throw new Error("Room session disposed.");
      await fetchSnapshot(epoch);
    };
    actionsRef.current = createRoomActions({ roomId, accept: safeAccept, resync: safeResync });

    const init = async () => {
      if (!PUBLIC_REALTIME_URL || !PUBLIC_REALTIME_KEY) {
        if (!cancelled && epochRef.current === epoch) {
          setStatus("closed");
          setError("Realtime public configuration is unavailable. Voting is paused.");
        }
        try { await fetchSnapshot(epoch); } catch (err) {
          if (!cancelled && epochRef.current === epoch) setError(err instanceof Error ? err.message : "Room snapshot unavailable");
        }
        if (!cancelled && epochRef.current === epoch) setLoading(false);
        return;
      }
      try {
        const handle = await startRoomRealtime({
          roomId,
          supabaseUrl: PUBLIC_REALTIME_URL,
          publishableKey: PUBLIC_REALTIME_KEY,
          onSnapshot: safeAccept,
          onStatus: (value) => {
            if (cancelled || epochRef.current !== epoch || revokedRef.current) return;
            if (value === "closed") {
              revoke(null, epoch); // fail closed even if the terminal error arrives later
              return;
            }
            setStatus(value);
            if (value === "live") setError(null);
          },
          onError: (err) => {
            if (cancelled || epochRef.current !== epoch || revokedRef.current) return;
            if (isTerminalVotingAccessFailure(err)) {
              const code = (err as { status?: unknown }).status;
              revoke(typeof code === "number" ? code : null, epoch);
              return;
            }
            setError(err.message);
          },
          presenceHeartbeatMs: 30000,
          sendPresenceOnDisconnect: true,
        });
        if (cancelled || epochRef.current !== epoch || revokedRef.current) await handle();
        else {
          realtimeRef.current = handle;
          if (handle.status() === "closed") revoke(null, epoch);
          else setStatus(handle.status());
        }
      } catch (err) {
        if (cancelled || epochRef.current !== epoch || revokedRef.current) return;
        if (isTerminalVotingAccessFailure(err)) {
          const code = (err as { status?: unknown }).status;
          revoke(typeof code === "number" ? code : null, epoch);
          return;
        }
        setStatus("closed");
        setError(err instanceof Error ? err.message : "Unable to subscribe to room updates");
        // Display an authenticated card only if this fresh GET still authorizes it.
        try { await fetchSnapshot(epoch); } catch { /* keep error or revocation state */ }
      } finally {
        if (!cancelled && epochRef.current === epoch) setLoading(false);
      }
    };
    void init();
    return () => {
      cancelled = true;
      if (epochRef.current === epoch) epochRef.current++;
      actionsRef.current = null;
      const handle = realtimeRef.current;
      realtimeRef.current = null;
      if (handle) void handle().catch(() => undefined);
    };
  }, [roomId, sessionRevision, accept, fetchSnapshot, revoke]);

  if (accessLoss) {
    return (
      <section role="alert" data-testid="cine024-access-revoked" className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 text-[var(--cm-ink)]">
        <h1 className="text-2xl font-bold">Room access ended</h1>
        <p>{accessLoss.message}</p>
        <p className="text-sm text-[var(--cm-ink-muted)]">Private voting details have been cleared. Rejoin through the room invitation to restore a valid session.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/cinematch" className="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--cm-border)] px-4 font-semibold">Return to CineMatch</Link>
          <button type="button" disabled={checkingAccess} onClick={() => void retryAuthorization()}
            className="min-h-[44px] rounded-lg border border-[var(--cm-border)] px-4 font-semibold disabled:opacity-50">
            {checkingAccess ? "Verifying..." : "Verify current room access"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-8 sm:px-6">
      {error && (
        <CineMatchAlertCard code="ROOM_CONNECTION" message={error} onRetry={() => void resyncWithSnapshot().catch(() => undefined)} />
      )}
      {snapshot && (snapshot.room.status === "MATCHED" || snapshot.room.status === "EXHAUSTED" || snapshot.room.status === "EXPIRED") && (
        <section role="status" data-testid="cine026-result-handoff" className="space-y-3 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-4 text-[var(--cm-ink)]">
          <p>The server has finished this screening round. Open the authoritative result to see the outcome.</p>
          <Link data-testid="cine026-open-result" href={`/cinematch/result/${encodeURIComponent(roomId)}`}
            className="inline-flex min-h-[44px] items-center font-bold text-[var(--cm-brand-text)] underline underline-offset-4">
            View server-confirmed result
          </Link>
        </section>
      )}
      {snapshot?.room.status === "LOBBY" && (
        <Link href={`/cinematch/room/${encodeURIComponent(roomId)}`}
          className="inline-flex min-h-[44px] items-center font-bold text-[var(--cm-brand-text)] underline underline-offset-4">
          Return to room lobby
        </Link>
      )}
      <CineMatchVotingPanel
        snapshot={snapshot}
        loading={loading}
        connection={status}
        offline={offline}
        onVote={async (input) => {
          const epoch = epochRef.current;
          if (revokedRef.current || !actionsRef.current) throw new Error("Room authorization is not available.");
          const result = await actionsRef.current.vote(input);
          if (!result.ok && TERMINAL_HTTP.has(result.status)) revoke(result.status, epoch);
          return result;
        }}
        onResync={resyncWithSnapshot}
      />
    </div>
  );
}
