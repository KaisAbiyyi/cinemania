"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

function safeSnapshot(value: RoomSnapshot): VotingSnapshot | null {
  const room = value.room as unknown as SafeRoomSnapshot;
  const viewer = value.viewer as RoomSessionViewer | undefined;
  if (!room || !viewer || typeof room.stateVersion !== "number" ||
    !Number.isSafeInteger(room.stateVersion) || typeof room.roomId !== "string" ||
    typeof room.status !== "string" || !Array.isArray(room.participants) ||
    typeof viewer.isEligibleVoter !== "boolean") return null;
  return { room, viewer };
}

/** CINE-024: UI wiring only. The backend's snapshot, CSRF, cookies and vote rules are unchanged. */
export function CineMatchVotingClient({ roomId }: { roomId: string }) {
  const [snapshot, setSnapshot] = useState<VotingSnapshot | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentRef = useRef<VotingSnapshot | null>(null);
  const realtimeRef = useRef<RoomRealtimeHandle | null>(null);
  const actionsRef = useRef<ReturnType<typeof createRoomActions> | null>(null);

  const accept = useCallback((value: RoomSnapshot): boolean => {
    const next = safeSnapshot(value);
    if (!next || next.room.roomId !== roomId) return false;
    const previous = currentRef.current;
    if (previous && next.room.stateVersion < previous.room.stateVersion) return false;
    currentRef.current = next;
    setSnapshot(next);
    setError(null);
    return true;
  }, [roomId]);

  const fetchSnapshot = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/rooms/" + encodeURIComponent(roomId), {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      let code = "SNAPSHOT_FAILED";
      try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === "string") code = body.error;
      } catch { /* ignore invalid error body */ }
      throw new Error("Room snapshot refused (" + response.status + ", " + code + ").");
    }
    const value = await response.json() as RoomSnapshot;
    if (!accept(value)) throw new Error("Server returned a stale or invalid room snapshot.");
  }, [roomId, accept]);

  const resync = useCallback(async (): Promise<void> => {
    if (realtimeRef.current) await realtimeRef.current.resync();
    else await fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    actionsRef.current = createRoomActions({ roomId, accept, resync });
    return () => { actionsRef.current = null; };
  }, [roomId, accept, resync]);

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
    currentRef.current = null;
    setSnapshot(null);
    setError(null);
    setLoading(true);
    setStatus("connecting");

    const init = async () => {
      if (!PUBLIC_REALTIME_URL || !PUBLIC_REALTIME_KEY) {
        if (!cancelled) {
          setStatus("closed");
          setError("Realtime public configuration is unavailable. Voting is paused; no private capability was exposed.");
        }
        try { await fetchSnapshot(); } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : "Room snapshot unavailable");
        }
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const handle = await startRoomRealtime({
          roomId,
          supabaseUrl: PUBLIC_REALTIME_URL,
          publishableKey: PUBLIC_REALTIME_KEY,
          onSnapshot: (value) => { if (!cancelled) accept(value); },
          onStatus: (value) => {
            if (!cancelled) {
              setStatus(value);
              if (value === "live") setError(null);
            }
          },
          onError: (err) => { if (!cancelled) setError(err.message); },
          presenceHeartbeatMs: 30000,
          sendPresenceOnDisconnect: true,
        });
        if (cancelled) await handle();
        else {
          realtimeRef.current = handle;
          setStatus(handle.status());
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("closed");
          setError(err instanceof Error ? err.message : "Unable to subscribe to room updates");
        }
        // A safe read can still display the latest card; voting remains disabled until live.
        try { await fetchSnapshot(); } catch { /* keep the realtime error */ }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void init();
    return () => {
      cancelled = true;
      const active = realtimeRef.current;
      realtimeRef.current = null;
      if (active) void active();
    };
  }, [roomId, accept, fetchSnapshot]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-8 sm:px-6">
      {error && (
        <CineMatchAlertCard code="ROOM_CONNECTION" message={error} onRetry={() => void resync().catch(() => undefined)} />
      )}
      <CineMatchVotingPanel
        snapshot={snapshot}
        loading={loading}
        connection={status}
        offline={offline}
        onVote={(input) => {
          if (!actionsRef.current) throw new Error("Room action layer is not initialized");
          return actionsRef.current.vote(input);
        }}
        onResync={resync}
      />
    </div>
  );
}
