"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clapperboard, LogOut, Play, RefreshCw, Share2, SlidersHorizontal, Users } from "lucide-react";
import type { RealtimeStatus } from "@/lib/realtime/roomRealtime";
import {
  CineMatchAlertCard,
  ConnectionStatusBanner,
  ParticipantRosterList,
  RoomCodeChip,
} from "@/components/cinematch/CineMatchPrimitives";
import {
  isRoomPayload,
  RoomClientError,
  roomErrorMessage,
  roomRequest,
  type RoomPayload,
} from "./clientApi";

const SORT_CHOICES = [
  { value: "popularity.desc", label: "Most popular first" },
  { value: "vote_average.desc", label: "Highest rated first" },
  { value: "primary_release_date.desc", label: "Newest releases first" },
] as const;

export function RoomLobby({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [data, setData] = useState<RoomPayload | null>(null);
  const [connection, setConnection] = useState<RealtimeStatus>("connecting");
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<RoomClientError | null>(null);
  const [busy, setBusy] = useState<"start" | "leave" | "filter" | "share" | null>(null);
  const [sortChoice, setSortChoice] = useState<string>("popularity.desc");
  const [shareMessage, setShareMessage] = useState("");
  const inFlight = useRef(false);
  const mutationInFlight = useRef(false);
  const mounted = useRef(false);

  const accept = useCallback((payload: unknown): boolean => {
    if (!isRoomPayload(payload)) return false;
    if (!mounted.current) return true;
    setData((previous) => {
      if (previous && previous.room.stateVersion > payload.room.stateVersion) return previous;
      return payload;
    });
    return true;
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true;
    try {
      const fresh = await roomRequest<unknown>("/api/rooms/" + encodeURIComponent(roomId));
      if (!accept(fresh)) throw new RoomClientError("INVALID_RESPONSE", "Invalid room snapshot.", 502);
      if (mounted.current) {
        setError(null);
        // No browser Realtime configuration is published; never label polling as "Live".
        setConnection("degraded");
      }
    } catch (cause) {
      if (mounted.current) {
        setConnection("reconnecting");
        setError(cause instanceof RoomClientError ? cause : new RoomClientError("NETWORK_ERROR", "Room synchronization failed.", 0));
      }
    } finally {
      inFlight.current = false;
    }
  }, [roomId, accept]);

  useEffect(() => {
    mounted.current = true;
    const checkOnline = () => setOffline(!navigator.onLine);
    checkOnline();
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden" && navigator.onLine) void refresh();
    }, 3000);
    const wake = () => {
      checkOnline();
      if (navigator.onLine) void refresh();
    };
    window.addEventListener("online", wake);
    window.addEventListener("offline", checkOnline);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", checkOnline);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh]);

  useEffect(() => {
    if (data?.room.deckFilter.sort_by) setSortChoice(data.room.deckFilter.sort_by);
  }, [data?.room.deckFilter.sort_by]);

  async function perform(type: "start" | "leave" | "filter") {
    if (mutationInFlight.current || !data || offline) return;
    const { room, viewer } = data;
    if (type === "start" && (room.status !== "LOBBY" || viewer.role !== "HOST" || viewer.canStart !== true || !room.canStart)) return;
    if (type === "filter" && (room.status !== "LOBBY" || viewer.role !== "HOST")) return;
    if (type === "leave" && room.status !== "LOBBY") return;
    mutationInFlight.current = true;
    setBusy(type);
    setError(null);
    try {
      const base = "/api/rooms/" + encodeURIComponent(roomId);
      if (type === "leave") {
        await roomRequest<unknown>(base + "/leave", { method: "POST", body: {} });
        router.push("/cinematch/room");
        return;
      }
      const path = type === "start" ? "/start" : "/filters";
      const body = type === "start" ? {} : {
        deckFilter: { ...room.deckFilter, sort_by: sortChoice, include_adult: false },
      };
      const response = await roomRequest<unknown>(base + path, {
        method: type === "start" ? "POST" : "PATCH", body,
      });
      if (type === "start" && !accept(response)) throw new RoomClientError("INVALID_RESPONSE", "Invalid round response.", 502);
      await refresh();
    } catch (cause) {
      setError(cause instanceof RoomClientError ? cause : new RoomClientError("NETWORK_ERROR", "Room action failed.", 0));
      // Start and leave are non-idempotent; never blindly repeat after an ambiguous response.
      void refresh();
    } finally {
      mutationInFlight.current = false;
      setBusy(null);
    }
  }

  async function shareInvite() {
    if (!data || busy) return;
    const path = data.room.invitePath;
    // Invite is a public six-character join path; never send participant/session capabilities.
    const url = window.location.origin + path;
    if (typeof navigator.share !== "function") {
      setShareMessage("Native sharing is unavailable. Use Copy Invite Link below.");
      return;
    }
    setBusy("share");
    try {
      await navigator.share({ title: "Join my CineMatch Movie Night", url });
      setShareMessage("Invite shared.");
    } catch (cause) {
      // The user cancelling native share is not a success or an error.
      if (!(cause instanceof Error && cause.name === "AbortError")) {
        setShareMessage("Sharing did not complete. Use Copy Invite Link below.");
      }
    } finally {
      setBusy(null);
    }
  }

  const room = data?.room;
  const viewer = data?.viewer;
  const isHost = viewer?.role === "HOST";
  const canStart = Boolean(isHost && viewer?.canStart && room?.canStart && !offline && !busy && connection === "degraded");

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 space-y-6 px-4 py-8 sm:px-6 sm:py-12" data-testid="cm-lobby">
      <Link href="/cinematch/room" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--cm-brand-text)] underline underline-offset-4"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Room entry</Link>
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-[var(--cm-brand-text)]">
          <Clapperboard className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-[0.2em]">CineMatch Movie Night</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[var(--cm-ink)]">{room?.status === "LOBBY" ? "The Screening Lobby" : "Your Screening Room"}</h1>
        <p className="text-[var(--cm-ink-muted)]">{room ? "Welcome, " + viewer?.displayName + ". Your membership: " + (isHost ? "Host" : "Guest") + "." : "Checking your private room membership…"}</p>
      </header>
      <ConnectionStatusBanner status={connection} isOffline={offline} onResync={() => void refresh()} />
      {error && <CineMatchAlertCard code={error.code} message={roomErrorMessage(error)} retryAfterSeconds={error.retryAfterSeconds} onRetry={() => void refresh()} />}
      {!room && (
        <section role="status" aria-live="polite" className="rounded-2xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-8 text-[var(--cm-ink)]">
          {error ? "Room access unavailable. Check your invitation or try again." : "Loading the room snapshot…"}
          {error && <p className="mt-3 text-sm"><Link href="/cinematch/room" className="underline">Create or join another room</Link></p>}
        </section>
      )}
      {room && (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <section className="min-w-0 space-y-5">
            <RoomCodeChip code={room.code} invitePath={room.invitePath} />
            <div className="rounded-2xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-5 sm:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-xl font-bold text-[var(--cm-ink)]"><Users className="h-5 w-5" aria-hidden="true" /> Participants</h2>
                <span data-testid="cm-participant-count" className="rounded-full border border-[var(--cm-border)] px-3 py-1 font-mono text-sm text-[var(--cm-ink)] tabular-nums">
                  {room.participantCount} / {room.maxParticipants}
                </span>
              </div>
              <p className="mb-4 text-sm text-[var(--cm-ink-muted)]">{room.connectedParticipantCount} connected. Guests must join before the host starts the round.</p>
              <ParticipantRosterList participants={room.participants} maxParticipants={room.maxParticipants} compact />
            </div>
          </section>
          <aside className="min-w-0 space-y-5">
            <section className="space-y-4 rounded-2xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold text-[var(--cm-ink)]">Screening controls</h2>
                <span className="rounded-full border border-[var(--cm-border)] px-3 py-1 text-xs font-semibold text-[var(--cm-ink)]">{isHost ? "Host" : "Guest"}</span>
              </div>
              <p className="text-sm text-[var(--cm-ink-muted)]">Room status: <strong className="text-[var(--cm-ink)]">{room.status}</strong></p>
              {room.status === "LOBBY" ? (
                <>
                  <p className="text-sm text-[var(--cm-ink-muted)]">A round needs {room.minParticipantsToStart}–{room.maxParticipants} connected participants. The server alone decides when it can start.</p>
                  {isHost ? (
                    <button type="button" disabled={!canStart} onClick={() => void perform("start")} aria-busy={busy === "start"} data-testid="cm-start-round"
                      className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--cm-brand)] px-4 text-sm font-bold text-[var(--cm-brand-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)] disabled:cursor-not-allowed disabled:opacity-50">
                      <Play className="h-4 w-4" aria-hidden="true" /> {busy === "start" ? "Starting…" : "Start Movie Night"}
                    </button>
                  ) : (
                    <p data-testid="cm-guest-wait" role="status" className="rounded-lg bg-[var(--cm-surface-subtle)] px-3 py-4 text-sm font-semibold text-[var(--cm-ink)]">Waiting for the host to start. Only the host can start a round.</p>
                  )}
                  {isHost && !room.canStart && <p role="status" className="text-sm text-[var(--cm-ink-muted)]">Invite at least one connected guest to unlock Start.</p>}
                  <button type="button" onClick={() => void perform("leave")} disabled={Boolean(busy) || offline}
                    className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--cm-ink-muted)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Leave room
                  </button>
                </>
              ) : (
                <p role="status" className="rounded-lg bg-[var(--cm-warning-bg)] p-4 text-sm text-[var(--cm-warning-ink)]">
                  {room.status === "ACTIVE" ? "Round started. Voting interaction is being delivered separately in CINE-024; room state remains server-authoritative." : "This round is no longer in the lobby. Results and recovery controls are being delivered in CINE-025."}
                </p>
              )}
            </section>
            <section className="space-y-4 rounded-2xl border border-[var(--cm-border)] bg-[var(--cm-surface-subtle)] p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--cm-ink)]"><SlidersHorizontal className="h-5 w-5" aria-hidden="true" /> Film preferences</h2>
              <p className="text-sm text-[var(--cm-ink-muted)]">Language: {room.deckFilter.language}. Adult titles are excluded.</p>
              {isHost && room.status === "LOBBY" ? (
                <div className="space-y-3">
                  <label htmlFor="cm-sort" className="block text-sm font-semibold text-[var(--cm-ink)]">Movie ordering</label>
                  <select id="cm-sort" value={sortChoice} onChange={(event) => setSortChoice(event.target.value)} disabled={Boolean(busy) || offline}
                    className="min-h-[44px] w-full rounded-lg border border-[var(--cm-border)] bg-[var(--cm-surface)] px-3 text-sm text-[var(--cm-ink)]">
                    {SORT_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                  </select>
                  <button type="button" onClick={() => void perform("filter")} disabled={Boolean(busy) || offline || sortChoice === room.deckFilter.sort_by}
                    className="min-h-[44px] w-full rounded-lg border border-[var(--cm-border)] bg-[var(--cm-surface)] px-4 text-sm font-semibold text-[var(--cm-ink)] disabled:opacity-50"> {busy === "filter" ? "Saving…" : "Save film preferences"} </button>
                </div>
              ) : <p className="text-sm text-[var(--cm-ink-muted)]">Movie ordering: {room.deckFilter.sort_by}. Only the host can change preferences in the lobby.</p>}
            </section>
            <button type="button" onClick={() => void shareInvite()} disabled={Boolean(busy)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-surface)] px-4 text-sm font-semibold text-[var(--cm-ink)] focus-visible:outline-2 focus-visible:outline-offset-2">
              <Share2 className="h-4 w-4" aria-hidden="true" /> Share invitation
            </button>
            {shareMessage && <p role="status" className="text-sm text-[var(--cm-ink-muted)]">{shareMessage}</p>}
            <button type="button" onClick={() => void refresh()} className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--cm-brand-text)]">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh room state
            </button>
          </aside>
        </div>
      )}
    </main>
  );
}
