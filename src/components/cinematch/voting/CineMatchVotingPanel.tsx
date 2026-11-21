"use client";

import { useEffect, useRef, useState } from "react";
import { Heart, SkipForward, RefreshCw, ShieldCheck } from "lucide-react";
import {
  CandidatePosterStage,
  CineMatchAlertCard,
  ConnectionStatusBanner,
  ParticipantRosterList,
} from "@/components/cinematch/CineMatchPrimitives";
import type { RoomActionResult, VoteChoice } from "@/lib/realtime/roomActions";
import type { RealtimeStatus } from "@/lib/realtime/roomRealtime";
import type { SafeRoomSnapshot, RoomSessionViewer } from "@/lib/server/room/roomSnapshot";

export interface VotingSnapshot {
  room: SafeRoomSnapshot;
  viewer: RoomSessionViewer;
}

interface VotingPanelProps {
  snapshot: VotingSnapshot | null;
  connection: RealtimeStatus;
  offline?: boolean;
  loading?: boolean;
  onVote: (input: { candidateId: string; movieId: number; vote: VoteChoice; roundId: string | null }) => Promise<RoomActionResult>;
  onResync: () => Promise<void>;
}

type Submission = {
  key: string;
  choice: VoteChoice;
  phase: "sending" | "confirmed" | "unknown" | "failed";
  error?: { code: string; message: string };
};

/** Only the server snapshot is allowed to declare a match, advance a card or lock a vote. */
export function CineMatchVotingPanel({
  snapshot,
  connection,
  offline = false,
  loading = false,
  onVote,
  onResync,
}: VotingPanelProps) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [dragPx, setDragPx] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const room = snapshot?.room;
  const viewer = snapshot?.viewer;
  const candidate = room?.currentCandidate;
  const key = (room?.currentRoundId ?? "-") + ":" + (candidate?.candidateId ?? "-");
  const currentSubmission = submission?.key === key ? submission : null;
  const recordedChoice = candidate ? viewer?.userVotes?.[candidate.candidateId] : undefined;
  const active = room?.status === "ACTIVE";
  const connected = connection === "live" && !offline;
  const eligible = active && Boolean(viewer?.isEligibleVoter) && Boolean(candidate) &&
    viewer?.nextCandidateIndex === room?.currentCandidateIndex && !recordedChoice;
  const canVote = Boolean(eligible && connected && !loading && !currentSubmission && !inFlight.current);
  const waiting = Boolean(active && candidate && (recordedChoice || (viewer?.isEligibleVoter && viewer.nextCandidateIndex === null)));
  const cardNumber = typeof room?.currentCandidateIndex === "number" ? room.currentCandidateIndex + 1 : 0;

  async function resync() {
    if (resyncing) return;
    setResyncing(true);
    setResyncError(null);
    try {
      await onResync();
    } catch {
      setResyncError("Could not retrieve the latest authoritative room snapshot. Your previous vote may already have been recorded.");
    } finally {
      setResyncing(false);
    }
  }

  async function submit(choice: VoteChoice, retryUnknown = false) {
    if (!candidate || !room || inFlight.current) return;
    if (!retryUnknown && !canVote) return;
    if (retryUnknown && !(currentSubmission?.phase === "unknown" && currentSubmission.choice === choice && connected)) return;
    inFlight.current = true;
    setSubmission({ key, choice, phase: "sending" });
    setDragPx(0);
    try {
      const result = await onVote({
        candidateId: candidate.candidateId,
        movieId: candidate.movieId,
        vote: choice,
        roundId: room.currentRoundId,
      });
      if (result.ok) {
        // No optimistic change to MATCHED, card number or userVotes; await the server snapshot.
        setSubmission({ key, choice, phase: "confirmed" });
        try { await onResync(); } catch { /* the realtime reconciler will retry */ }
      } else if (result.transient || result.stale) {
        // A lost acknowledgment is ambiguous. Only the SAME idempotent intent may be retried.
        setSubmission({
          key, choice, phase: "unknown",
          error: { code: result.code, message: result.message },
        });
      } else {
        setSubmission({
          key, choice, phase: "failed",
          error: { code: result.code, message: result.message },
        });
      }
    } catch {
      setSubmission({
        key, choice, phase: "unknown",
        error: { code: "NETWORK_ERROR", message: "Vote outcome is unknown; resync before retrying the same choice." },
      });
    } finally {
      inFlight.current = false;
    }
  }

  const resetDrag = () => {
    pointer.current = null;
    setDragPx(0);
  };

  if (loading && !snapshot) {
    return <div role="status" data-testid="cine024-loading" className="rounded-2xl border border-[var(--cm-border)] p-6 text-[var(--cm-ink)]">Loading authoritative room state…</div>;
  }

  if (!snapshot) {
    return (
      <section className="space-y-4">
        <ConnectionStatusBanner status={connection} isOffline={offline} onResync={() => void resync()} resyncing={resyncing} />
        <CineMatchAlertCard code="SNAPSHOT_UNAVAILABLE" message="Your room state is unavailable. Reconnect before voting." onRetry={() => void resync()} />
      </section>
    );
  }

  return (
    <section data-testid="cine024-voting-panel" aria-label="CineMatch movie voting" className="mx-auto grid w-full max-w-6xl min-w-0 gap-5 lg:grid-cols-12">
      <div className="min-w-0 space-y-4 lg:col-span-7">
        <ConnectionStatusBanner
          status={connection}
          isOffline={offline}
          onResync={() => void resync()}
          resyncing={resyncing}
        />
        {resyncError && (
          <CineMatchAlertCard code="RESYNC_FAILED" message={resyncError} onRetry={() => void resync()} />
        )}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--cm-brand-text)]">Movie Night · Room {room.code}</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--cm-ink)]">Pick your next movie</h1>
          </div>
          <p data-testid="cine024-progress" className="rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-3 py-2 font-mono text-sm font-bold tabular-nums text-[var(--cm-ink)]">
            {cardNumber > 0 ? "Card " + String(cardNumber).padStart(2, "0") : "Card —"} / {room.deckSize || room.expectedDeckSize}
          </p>
        </header>

        {active && candidate && (
          <>
            <div
              data-testid="cine024-swipe-region"
              role="group"
              aria-label="Active movie voting deck. Focus here and press Left arrow or S to skip; Right arrow or L to like."
              tabIndex={eligible && connected ? 0 : -1}
              className="touch-pan-y rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--cm-brand-text)]"
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.repeat || !canVote) return;
                if (event.key === "ArrowLeft" || event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  void submit("SKIP");
                } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") {
                  event.preventDefault();
                  void submit("LIKE");
                }
              }}
              onPointerDown={(event) => {
                if (!canVote || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
                pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* optional */ }
              }}
              onPointerMove={(event) => {
                if (pointer.current?.id !== event.pointerId || reducedMotion) return;
                const dx = event.clientX - pointer.current.x;
                const dy = event.clientY - pointer.current.y;
                if (Math.abs(dx) > Math.abs(dy)) setDragPx(Math.max(-140, Math.min(140, dx)));
              }}
              onPointerUp={(event) => {
                const start = pointer.current;
                resetDrag();
                if (!start || start.id !== event.pointerId || !canVote) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) >= 75 && Math.abs(dx) > Math.abs(dy) * 1.3) {
                  void submit(dx > 0 ? "LIKE" : "SKIP");
                }
              }}
              onPointerCancel={resetDrag}
              onLostPointerCapture={resetDrag}
            >
              <CandidatePosterStage candidate={candidate} badgeText={recordedChoice ? "Vote recorded" : "Server-selected title"} dragOffsetPx={reducedMotion ? 0 : dragPx} />
            </div>

            {waiting ? (
              <div role="status" aria-live="polite" data-testid="cine024-waiting" className="rounded-xl border border-[var(--cm-like)]/35 bg-[var(--cm-like-soft-bg)] p-4 text-[var(--cm-like-soft-ink)]">
                <span className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5" aria-hidden="true" /> {recordedChoice ? "Your " + recordedChoice + " vote is locked" : "Waiting for server resolution"}</span>
                <p className="mt-1 text-sm">Waiting for the frozen group of {room.frozenQuorum ?? room.participantCount} eligible voters. Other participants&apos; private decisions are not displayed.</p>
              </div>
            ) : active && viewer?.isEligibleVoter && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3" role="group" aria-label="Choose a movie vote">
                  <button type="button" data-testid="cine024-skip" disabled={!canVote} onClick={() => void submit("SKIP")}
                    className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[var(--cm-skip)] px-3 text-sm font-bold text-[var(--cm-skip-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-skip)] disabled:cursor-not-allowed disabled:opacity-50">
                    <SkipForward className="h-5 w-5" aria-hidden="true" /> Skip Film
                  </button>
                  <button type="button" data-testid="cine024-like" disabled={!canVote} onClick={() => void submit("LIKE")}
                    className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[var(--cm-like)] px-3 text-sm font-bold text-[var(--cm-like-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-like)] disabled:cursor-not-allowed disabled:opacity-50">
                    <Heart className="h-5 w-5" aria-hidden="true" /> Like Film
                  </button>
                </div>
                <p className="text-center text-xs text-[var(--cm-ink-muted)]">Swipe left to Skip, right to Like. Keyboard: S / L or ← / →. Only your first decision counts.</p>
                {currentSubmission && (
                  <div role="status" aria-live="polite" data-testid="cine024-submission" className="rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface-subtle)] p-3 text-sm text-[var(--cm-ink)]">
                    {currentSubmission.phase === "sending" && "Sending " + currentSubmission.choice + " to server…"}
                    {currentSubmission.phase === "confirmed" && "Server acknowledged your " + currentSubmission.choice + " vote. Synchronizing authoritative state…"}
                    {currentSubmission.phase === "unknown" && "The vote outcome is uncertain. Resync; you may retry only the same " + currentSubmission.choice + " decision."}
                    {currentSubmission.phase === "failed" && "Vote rejected by server. Resync to recover."}
                    {currentSubmission.error && (
                      <p className="mt-1 text-xs" data-testid="cine024-vote-error">{currentSubmission.error.code}: {currentSubmission.error.message}</p>
                    )}
                    {currentSubmission.phase === "unknown" && (
                      <button type="button" disabled={!connected} onClick={() => void submit(currentSubmission.choice, true)}
                        className="mt-3 min-h-[44px] rounded-lg border border-[var(--cm-border)] px-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
                        Retry same {currentSubmission.choice} vote
                      </button>
                    )}
                    {(currentSubmission.phase === "unknown" || currentSubmission.phase === "failed" || currentSubmission.phase === "confirmed") && (
                      <button type="button" onClick={() => void resync()} disabled={resyncing} className="ml-2 inline-flex min-h-[44px] items-center gap-2 px-3 font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2">
                        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Resync
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {active && !candidate && (
          <div role="status" className="rounded-xl border border-[var(--cm-border)] p-4 text-[var(--cm-ink)]">The room is active but no current card is available. Resync to restore server state.</div>
        )}
        {!active && (
          <div role="status" data-testid="cine024-server-phase" className="rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-5 text-[var(--cm-ink)]">
            <strong>Server phase: {room.status}</strong>
            <p className="mt-2 text-sm text-[var(--cm-ink-muted)]">{room.finishState.message} This panel does not decide matches; CINE-025 owns the final result and restart screens.</p>
          </div>
        )}
      </div>

      <aside className="min-w-0 space-y-4 lg:col-span-5" aria-label="Screening details">
        <ParticipantRosterList participants={room.participants} maxParticipants={room.maxParticipants} compact />
        <div className="rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface-subtle)] p-4 text-sm text-[var(--cm-ink)]">
          <h2 className="font-semibold">Room authority</h2>
          <p className="mt-1 text-[var(--cm-ink-muted)]">Only the server can record a vote, advance a card or confirm unanimous agreement.</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs tabular-nums">
            <div><dt className="text-[var(--cm-ink-muted)]">Snapshot version</dt><dd>{room.stateVersion}</dd></div>
            <div><dt className="text-[var(--cm-ink-muted)]">Frozen quorum</dt><dd>{room.frozenQuorum ?? "—"}</dd></div>
          </dl>
        </div>
      </aside>
    </section>
  );
}
