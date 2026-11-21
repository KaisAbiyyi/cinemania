"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Film, RefreshCw, Sparkles, Ticket, WifiOff } from "lucide-react";
import {
  CandidatePosterStage,
  copyTextToClipboard,
} from "@/components/cinematch/CineMatchPrimitives";
import { createRoomActions } from "@/lib/realtime/roomActions";
import {
  buildSafeMatchShare,
  isRetryAllowed,
  matchRevealKey,
  newerResult,
  parseResultPayload,
  type ResultPayload,
} from "./resultModel";

type CopyState =
  | { state: "idle" }
  | { state: "copied" }
  | { state: "failed"; text: string };

const buttonStyle =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)] disabled:cursor-not-allowed disabled:opacity-50";
const cardStyle =
  "rounded-2xl border border-[var(--cm-border)]/50 bg-[var(--cm-surface)] p-5 sm:p-7";

export function RoomResultExperience({ roomId }: { roomId: string }) {
  const [payload, setPayload] = useState<ResultPayload | null>(null);
  const payloadRef = useRef<ResultPayload | null>(null);
  const accessRevokedRef = useRef(false);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<"fresh" | "lobby" | null>(null);
  const pendingRef = useRef(false);
  const [copyState, setCopyState] = useState<CopyState>({ state: "idle" });
  const [animatedMatchKey, setAnimatedMatchKey] = useState<string | null>(null);

  const acceptSnapshot = useCallback(
    (value: unknown): boolean => {
      if (accessRevokedRef.current) return false;
      const parsed = parseResultPayload(value, roomId);
      if (!parsed) return false;
      const prior = payloadRef.current;
      const next = newerResult(prior, parsed);
      if (prior === next) return false;
      payloadRef.current = next;
      setPayload(next);
      setError(null);
      return true;
    },
    [roomId]
  );

  const resync = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}`,
        { credentials: "same-origin", cache: "no-store" }
      );

      if (!response.ok) {
        if ([401, 403, 404, 410].includes(response.status)) {
          // Do not keep rendering sensitive stale results after access is revoked.
          accessRevokedRef.current = true;
          setExpired(response.status === 410);
          payloadRef.current = null;
          setPayload(null);
          setError("Room access is unavailable or this room has expired.");
          return;
        }
        throw new Error("Snapshot request failed");
      }

      const responseBody: unknown = await response.json();
      if (!parseResultPayload(responseBody, roomId)) {
        throw new Error("Invalid authoritative snapshot");
      }
      acceptSnapshot(responseBody);
      setExpired(false);
      setError(null);
    } catch {
      // Keep the last authorized snapshot visible, but never call it live.
      setError("Cannot refresh room state. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [roomId, acceptSnapshot]);

  useEffect(() => {
    void resync();
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void resync();
      }
    };
    const refreshOnFocus = () => {
      if (navigator.onLine) void resync();
    };
    const handleNetwork = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void resync();
    };
    setOnline(navigator.onLine);
    const timer = window.setInterval(refreshIfVisible, 15000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("online", handleNetwork);
    window.addEventListener("offline", handleNetwork);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("online", handleNetwork);
      window.removeEventListener("offline", handleNetwork);
    };
  }, [resync]);

  const room = payload?.room;
  const revealKey = room ? matchRevealKey(room) : null;

  useEffect(() => {
    if (!revealKey) return;
    const storageKey = `cinematch:revealed:${revealKey}`;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Storage may be blocked. Never use it as an authorization signal.
    }
    setAnimatedMatchKey(revealKey);
  }, [revealKey]);

  const handleCopy = async () => {
    if (!room?.matchedCandidate || room.status !== "MATCHED") return;
    const shareText = buildSafeMatchShare(room.matchedCandidate);
    const copied = await copyTextToClipboard(shareText);
    setCopyState(copied.ok
      ? { state: "copied" }
      : { state: "failed", text: shareText });
  };

  const handleRetry = async (mode: "fresh" | "lobby") => {
    if (!payload || !isRetryAllowed(payload) || !online || pendingRef.current) return;
    pendingRef.current = true;
    setPendingRetry(mode);
    setError(null);
    setFeedback(null);
    try {
      // Construct the mutation handler in the event, not during React render.
      // It captures the authoritative snapshot gate without reading refs in render.
      const roomActions = createRoomActions({
        roomId,
        accept: (snapshot) => acceptSnapshot(snapshot),
        resync,
      });
      const result = await roomActions.retryRound({
        roundId: payload.room.currentRoundId,
        startRound: mode === "fresh",
        operationId: `retry:${payload.room.currentRoundId ?? "-"}:${mode}`,
      });
      if (result.ok) {
        setFeedback(mode === "fresh"
          ? "New round requested successfully. Open the room to continue."
          : "Room returned to the lobby. Open the room to continue.");
        await resync();
      } else {
        await resync();
        setError(result.stale
          ? "Room state changed. The latest result has been refreshed."
          : "Unable to start a new round. Check connection and retry safely.");
      }
    } finally {
      pendingRef.current = false;
      setPendingRetry(null);
    }
  };

  const roomHref = `/cinematch/room/${encodeURIComponent(roomId)}`;

  return (
    <main
      data-testid="cine025-result"
      className="mx-auto w-full max-w-4xl min-w-0 space-y-5 px-4 py-8 text-[var(--cm-ink)] sm:px-6 sm:py-12"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/cinematch"
          className="inline-flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-semibold text-[var(--cm-brand-text)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          CineMatch
        </Link>
        <button
          type="button"
          data-testid="cine025-resync"
          onClick={() => void resync()}
          className={`${buttonStyle} border border-[var(--cm-border)]/60 bg-[var(--cm-surface-elevated)] text-[var(--cm-ink)]`}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh result
        </button>
      </div>

      {!online && (
        <div role="status" className="flex items-center gap-2 rounded-xl bg-[var(--cm-offline-bg)] p-3 text-sm text-[var(--cm-offline-ink)]">
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          Offline — the last confirmed room result is shown; actions are paused.
        </div>
      )}
      {error && (
        <div role="alert" data-testid="cine025-error" className="rounded-xl border border-[var(--cm-skip)]/40 bg-[var(--cm-skip-soft-bg)] px-4 py-3 text-sm text-[var(--cm-skip-soft-ink)]">
          {error}
        </div>
      )}
      {feedback && <p role="status" className="rounded-xl bg-[var(--cm-like-soft-bg)] px-4 py-3 text-[var(--cm-like-soft-ink)]">{feedback}</p>}

      {loading && !room && (
        <div role="status" className={cardStyle}>Loading the authoritative room result…</div>
      )}
      {!loading && !room && (
        <section className={cardStyle}>
          <h1 className="text-2xl font-bold">{expired ? "Room expired" : "Result unavailable"}</h1>
          <p className="mt-2 text-[var(--cm-ink-muted)]">
            {expired
              ? "This room cannot be rejoined. Create or join a new CineMatch room."
              : "Only members of this room can see its result. Refresh to try again."}
          </p>
          {expired && <Link href="/cinematch" className="mt-3 inline-flex min-h-[44px] items-center text-[var(--cm-brand-text)] underline">Start another movie night</Link>}
        </section>
      )}

      {room?.status === "MATCHED" && room.matchedCandidate && (
        <section data-testid="cine025-match" className="space-y-5" aria-label="Unanimous movie match">
          <div className="rounded-2xl border border-[var(--cm-match-gold-border)] bg-[var(--cm-match-gold-bg)] p-5 text-center text-[var(--cm-match-gold-ink)] sm:p-7">
            <Sparkles className="mx-auto h-7 w-7" aria-hidden="true" />
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">
              IT&apos;S A MATCH!
            </h1>
            <p className="mt-2 text-sm font-medium">Every eligible guest liked the same film.</p>
          </div>
          <div data-testid="cine025-reveal" data-reveal-once={animatedMatchKey === revealKey ? "true" : "false"}>
            <CandidatePosterStage
              candidate={room.matchedCandidate}
              isMatched={animatedMatchKey === revealKey}
              badgeText="Unanimous Match"
            />
          </div>
          <div className={cardStyle}>
            <h2 className="text-lg font-bold">Your screening pick is confirmed</h2>
            <p className="mt-1 text-sm text-[var(--cm-ink-muted)]">Movie information sourced from TMDB. Streaming availability has not been verified.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                data-testid="cine025-copy-match"
                onClick={() => void handleCopy()}
                className={`${buttonStyle} bg-[var(--cm-brand)] text-[var(--cm-brand-ink)]`}
              >
                {copyState.state === "copied"
                  ? <Check className="h-4 w-4" aria-hidden="true" />
                  : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copyState.state === "copied" ? "Match copied" : "Copy movie match"}
              </button>
              <Link href={`/movie/${room.matchedCandidate.movieId}`} className={`${buttonStyle} border border-[var(--cm-border)] text-[var(--cm-ink)]`}>
                <Film className="h-4 w-4" aria-hidden="true" /> Movie details
              </Link>
            </div>
            {copyState.state === "copied" && <p role="status" className="mt-3 text-sm">Movie title copied (no room or participant credentials).</p>}
            {copyState.state === "failed" && (
              <div data-testid="cine025-copy-failure" role="alert" className="mt-3 rounded-xl bg-[var(--cm-warning-bg)] p-3 text-sm text-[var(--cm-warning-ink)]">
                Clipboard access was unavailable or denied. Copy this text manually:
                <code className="mt-2 block select-all break-words rounded bg-[var(--cm-surface)] p-2 font-mono text-[var(--cm-ink)]">{copyState.text}</code>
              </div>
            )}
          </div>
        </section>
      )}

      {(room?.finishState.code === "DECK_EXHAUSTED" ||
        room?.finishState.code === "ROUND_CANCELLED" ||
        room?.finishState.code === "ROOM_EXPIRED") && (
        <section data-testid="cine025-no-match" className={cardStyle}>
          <Ticket className="h-8 w-8 text-[var(--cm-brand-text)]" aria-hidden="true" />
          <h1 className="mt-3 text-3xl font-black">
            {room.finishState.code === "DECK_EXHAUSTED"
              ? "No match this round"
              : room.finishState.code === "ROUND_CANCELLED"
                ? "Round was cancelled"
                : "Room expired"}
          </h1>
          <p className="mt-3 text-[var(--cm-ink-muted)]">
            {room.finishState.code === "DECK_EXHAUSTED"
              ? `You screened ${room.deckSize} titles without a unanimous pick. Try another round together.`
              : room.finishState.message}
          </p>
          {isRetryAllowed(payload!) && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                data-testid="cine025-start-fresh"
                disabled={!online || pendingRetry !== null}
                onClick={() => void handleRetry("fresh")}
                className={`${buttonStyle} bg-[var(--cm-brand)] text-[var(--cm-brand-ink)]`}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {pendingRetry === "fresh" ? "Starting…" : "Start fresh movie round"}
              </button>
              <button
                type="button"
                data-testid="cine025-back-lobby"
                disabled={!online || pendingRetry !== null}
                onClick={() => void handleRetry("lobby")}
                className={`${buttonStyle} border border-[var(--cm-border)] bg-[var(--cm-surface-elevated)] text-[var(--cm-ink)]`}
              >
                Return to lobby
              </button>
            </div>
          )}
          {room.finishState.code === "DECK_EXHAUSTED" && !isRetryAllowed(payload!) && (
            <p className="mt-4 text-sm font-semibold text-[var(--cm-ink-muted)]">
              Only the host can retry, and at least two connected guests are required.
            </p>
          )}
          <Link href={room.finishState.code === "ROOM_EXPIRED" ? "/cinematch" : roomHref}
            className="mt-5 inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--cm-brand-text)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {room.finishState.code === "ROOM_EXPIRED" ? "Create or join another room" : "Open room"}
          </Link>
        </section>
      )}

      {room && !["MATCHED", "DECK_EXHAUSTED", "ROUND_CANCELLED", "ROOM_EXPIRED"].includes(
        room.status === "MATCHED" ? "MATCHED" : room.finishState.code
      ) && (
        <section data-testid="cine025-not-finished" className={cardStyle}>
          <h1 className="text-2xl font-bold">Screening in progress</h1>
          <p className="mt-2 text-[var(--cm-ink-muted)]">
            The room is currently {room.status.toLowerCase()}. This page will show a result after the server commits it.
          </p>
          <Link href={roomHref} className="mt-4 inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--cm-brand-text)] underline">Open room</Link>
        </section>
      )}

      {room && <p className="text-center text-xs text-[var(--cm-ink-muted)]">Server-confirmed state v{room.stateVersion} · Snapshot resync every 15 seconds while visible</p>}
    </main>
  );
}
