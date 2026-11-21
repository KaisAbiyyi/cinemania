"use client";

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import {
  CheckCircle2,
  Clapperboard,
  Film,
  Heart,
  Keyboard,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  WifiOff,
  X,
} from "lucide-react";
import {
  CINEMATCH_SCREEN_CONTRACTS,
  buildContractPreviewFixture,
  computeWcagContrastRatio,
  getThemeContrastPairs,
  type CineMatchScreenStateId,
} from "./designTokens";
import {
  CandidatePosterStage,
  CineMatchAlertCard,
  ConnectionStatusBanner,
  ParticipantRosterList,
  RoomCodeChip,
} from "./CineMatchPrimitives";
import { cn } from "@/lib/utils";

export function CineMatchContractStudio() {
  const [activeState, setActiveState] =
    useState<CineMatchScreenStateId>("create");
  const [noMatchVariant, setNoMatchVariant] = useState<
    "DECK_EXHAUSTED" | "ROUND_CANCELLED" | "ROOM_EXPIRED"
  >("DECK_EXHAUSTED");
  const [viewerRole, setViewerRole] = useState<"HOST" | "GUEST">("HOST");
  const [reducedMotionPreview, setReducedMotionPreview] = useState(false);

  // Interactive preview form/action states (zero backend mutations in CINE-022 contract studio)
  const [hostName, setHostName] = useState("Kais");
  const [joinCode, setJoinCode] = useState("CNM482");
  const [joinName, setJoinName] = useState("Nadia");
  const [lastSwipePreview, setLastSwipePreview] = useState<
    "LIKE" | "SKIP" | null
  >(null);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [resyncPulse, setResyncPulse] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const contract =
    CINEMATCH_SCREEN_CONTRACTS.find((item) => item.id === activeState) ??
    CINEMATCH_SCREEN_CONTRACTS[0];
  const fixture = buildContractPreviewFixture(activeState, noMatchVariant);

  const lightContrast = getThemeContrastPairs("light").map((pair) => ({
    ...pair,
    ratio: computeWcagContrastRatio(pair.foregroundHex, pair.backgroundHex),
  }));
  const darkContrast = getThemeContrastPairs("dark").map((pair) => ({
    ...pair,
    ratio: computeWcagContrastRatio(pair.foregroundHex, pair.backgroundHex),
  }));

  const effectiveCanStart =
    viewerRole === "HOST" && fixture.snapshot.canStart;
  const effectiveCanRetry =
    viewerRole === "HOST" && fixture.snapshot.finishState.retryAvailable;

  const triggerSimulatedVote = (choice: "LIKE" | "SKIP") => {
    setLastSwipePreview(choice);
    setDragOffsetPx(0);
  };

  const handleSwipeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (activeState !== "swipe") return;
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "s") {
      event.preventDefault();
      triggerSimulatedVote("SKIP");
    } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") {
      event.preventDefault();
      triggerSimulatedVote("LIKE");
    }
  };

  const handleSimulatedResync = () => {
    setResyncPulse(true);
    setTimeout(() => setResyncPulse(false), 600);
  };

  const handleCopyMatchShare = () => {
    const title = fixture.snapshot.matchedCandidate?.title ?? "Inception";
    setShareNote(`Prepared sanitized share summary: "Movie Night Match: ${title} (2010)"`);
    setTimeout(() => setShareNote(null), 2500);
  };

  return (
    <div
      data-testid="cinematch-contract-studio"
      className={cn(
        "mx-auto w-full max-w-6xl space-y-6 overflow-x-hidden pb-8",
        reducedMotionPreview && "cm-reduced-motion"
      )}
    >
      {/* Hero Header */}
      <header className="rounded-2xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface)] p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] px-3 py-1 text-xs font-semibold text-[var(--cm-ink)]">
              <Clapperboard className="h-3.5 w-3.5 text-[var(--cm-brand-text)]" aria-hidden="true" />
              <span>CINE-022 · F3 Visual Direction &amp; Interaction Contract</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--cm-ink)] sm:text-3xl">
              CineMatch Screening Room Design System
            </h1>
            <p className="text-sm leading-relaxed text-[var(--cm-ink-muted)] sm:text-base">
              Authoritative aesthetics, responsive layout geometry, WCAG AA
              contrast tokens, keyboard navigation, and 9-state backend contract
              mapping for guest-only 2–5 player Movie Night.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={reducedMotionPreview}
              onClick={() => setReducedMotionPreview((prev) => !prev)}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]",
                reducedMotionPreview
                  ? "border-[var(--cm-brand)] bg-[var(--cm-brand)] text-[var(--cm-brand-ink)]"
                  : "border-[var(--cm-border)]/60 bg-[var(--cm-surface-subtle)] text-[var(--cm-ink)]"
              )}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                Reduced Motion: {reducedMotionPreview ? "ON" : "System"}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={viewerRole === "GUEST"}
              onClick={() =>
                setViewerRole((prev) => (prev === "HOST" ? "GUEST" : "HOST"))
              }
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--cm-border)]/60 bg-[var(--cm-surface-subtle)] px-3.5 py-2 text-xs font-semibold text-[var(--cm-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
            >
              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Preview Role: {viewerRole}</span>
            </button>
          </div>
        </div>

        {/* 9-State Switcher */}
        <div
          role="tablist"
          aria-label="CineMatch screen states"
          className="mt-5 flex flex-wrap gap-2"
        >
          {CINEMATCH_SCREEN_CONTRACTS.map((item) => {
            const isSelected = item.id === activeState;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`cm-tab-${item.id}`}
                aria-selected={isSelected}
                aria-controls="cm-active-stage"
                data-state-id={item.id}
                onClick={() => {
                  setActiveState(item.id);
                  setLastSwipePreview(null);
                  setDragOffsetPx(0);
                }}
                className={cn(
                  "inline-flex min-h-[44px] items-center rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]",
                  isSelected
                    ? "border-[var(--cm-brand)] bg-[var(--cm-brand)] text-[var(--cm-brand-ink)]"
                    : "border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] text-[var(--cm-ink)] hover:bg-[var(--cm-surface-elevated)]"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Split: Interactive Screen Stage + Contract & Contrast Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Interactive Preview Stage */}
        <section
          id="cm-active-stage"
          role="tabpanel"
          aria-labelledby={`cm-tab-${activeState}`}
          data-testid={`cm-stage-${activeState}`}
          className="min-w-0 space-y-4 rounded-2xl border border-[var(--cm-border)]/50 bg-[var(--cm-surface)] p-4 shadow-sm sm:p-6 lg:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--cm-border)]/30 pb-3">
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--cm-brand-text)]">
                State: {activeState}
              </p>
              <h2 className="text-lg font-bold text-[var(--cm-ink)]">
                {contract.label}
              </h2>
            </div>
            <span className="rounded-lg border border-[var(--cm-border)]/40 bg-[var(--cm-surface-subtle)] px-2.5 py-1 font-mono text-xs font-medium text-[var(--cm-ink-muted)]">
              {contract.backendMapping.roomStatus} · {contract.backendMapping.finishCode}
            </span>
          </div>

          {/* 1. CREATE STATE */}
          {activeState === "create" && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setActiveState("lobby");
              }}
            >
              <div className="rounded-xl border border-[var(--cm-border)]/40 bg-[var(--cm-surface-subtle)] p-4">
                <p className="text-sm font-medium text-[var(--cm-ink)]">
                  Start a private 2–5 guest Movie Night deck. No account needed.
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="cm-create-name"
                  className="block text-sm font-semibold text-[var(--cm-ink)]"
                >
                  Your Display Name
                </label>
                <input
                  id="cm-create-name"
                  type="text"
                  maxLength={32}
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  aria-describedby="cm-create-name-hint"
                  className="min-h-[44px] w-full rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-3.5 py-2 text-sm text-[var(--cm-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                />
                <p
                  id="cm-create-name-hint"
                  className="text-xs text-[var(--cm-ink-muted)]"
                >
                  1–32 characters. Sanitized server-side; zero account required.
                </p>
              </div>

              <div className="rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] p-3.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--cm-ink)]">
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Default Round Deck Rules (Server-Authoritative)</span>
                </div>
                <p className="mt-1 text-xs text-[var(--cm-ink-muted)]">
                  20 unique TMDB films · Adult content strictly disallowed · Shared
                  lobby filters adjustable before round start.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="submit"
                  className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--cm-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--cm-brand-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  <span>Create Screening Room</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveState("join")}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--cm-ink)] hover:bg-[var(--cm-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                >
                  Have a code? Join Room
                </button>
              </div>
            </form>
          )}

          {/* 2. JOIN STATE */}
          {activeState === "join" && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setActiveState("lobby");
              }}
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="cm-join-code"
                  className="block text-sm font-semibold text-[var(--cm-ink)]"
                >
                  Room Code or Invite Link
                </label>
                <input
                  id="cm-join-code"
                  type="text"
                  value={joinCode}
                  onChange={(e) =>
                    setJoinCode(
                      e.target.value
                        .replace(/^.*code=/i, "")
                        .replace(/[^a-zA-Z0-9]/g, "")
                        .toUpperCase()
                        .slice(0, 6)
                    )
                  }
                  aria-describedby="cm-join-code-hint"
                  className="min-h-[44px] w-full rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-3.5 py-2 font-mono text-base font-bold tracking-[0.2em] text-[var(--cm-ink)] uppercase tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                />
                <p
                  id="cm-join-code-hint"
                  className="text-xs text-[var(--cm-ink-muted)]"
                >
                  6-character room code (e.g. CNM482). Query secrets are stripped automatically.
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="cm-join-name"
                  className="block text-sm font-semibold text-[var(--cm-ink)]"
                >
                  Your Display Name
                </label>
                <input
                  id="cm-join-name"
                  type="text"
                  maxLength={32}
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-3.5 py-2 text-sm text-[var(--cm-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-[var(--cm-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--cm-brand-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                >
                  Join Screening Room
                </button>
                <button
                  type="button"
                  onClick={() => setActiveState("create")}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--cm-ink)] hover:bg-[var(--cm-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                >
                  Create Instead
                </button>
              </div>
            </form>
          )}

          {/* 3. LOBBY STATE */}
          {activeState === "lobby" && (
            <div className="space-y-4">
              <ConnectionStatusBanner status={fixture.realtimeStatus} />
              <RoomCodeChip
                code={fixture.snapshot.code}
                invitePath={fixture.snapshot.invitePath}
              />
              <ParticipantRosterList
                participants={fixture.snapshot.participants}
                maxParticipants={fixture.snapshot.maxParticipants}
              />

              <div className="rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--cm-ink)]">
                    Common Deck Filters ({viewerRole === "HOST" ? "Host Editable" : "Read-Only"})
                  </span>
                  <span className="font-mono text-xs text-[var(--cm-ink-muted)]">
                    Sci-Fi &amp; Adventure · Rating &ge; 7.0
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {viewerRole === "HOST" ? (
                  <button
                    type="button"
                    disabled={!effectiveCanStart}
                    onClick={() => setActiveState("swipe")}
                    className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--cm-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--cm-brand-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)] disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    <span>Start Movie Night (20 titles)</span>
                  </button>
                ) : (
                  <div
                    role="status"
                    className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] px-4 py-2 text-sm font-medium text-[var(--cm-ink)]"
                  >
                    Waiting for host Kais to start the round...
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setActiveState("create")}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--cm-ink)] hover:bg-[var(--cm-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                >
                  Leave Room
                </button>
              </div>
            </div>
          )}

          {/* 4. SWIPE STATE */}
          {activeState === "swipe" && fixture.snapshot.currentCandidate && (
            <div
              className="space-y-4"
              tabIndex={0}
              onKeyDown={handleSwipeKeyDown}
              aria-label="Active movie voting deck. Press Left Arrow or S to Skip, Right Arrow or L to Like."
            >
              <ConnectionStatusBanner status={fixture.realtimeStatus} />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-[var(--cm-surface-subtle)] px-2.5 py-1 font-mono text-xs font-bold text-[var(--cm-ink)] tabular-nums border border-[var(--cm-border)]/40">
                    Card 04 / 20
                  </span>
                  <span className="text-xs text-[var(--cm-ink-muted)]">
                    Unanimous LIKE required (4 voters frozen)
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-[var(--cm-ink-muted)]">
                  <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>&larr; Skip / &rarr; Like</span>
                </span>
              </div>

              <div
                onPointerDown={(e) => setDragStartX(e.clientX)}
                onPointerMove={(e) => {
                  if (dragStartX !== null) {
                    setDragOffsetPx(Math.max(-90, Math.min(90, e.clientX - dragStartX)));
                  }
                }}
                onPointerUp={() => {
                  if (dragOffsetPx > 55) triggerSimulatedVote("LIKE");
                  else if (dragOffsetPx < -55) triggerSimulatedVote("SKIP");
                  else setDragOffsetPx(0);
                  setDragStartX(null);
                }}
                onPointerCancel={() => {
                  setDragOffsetPx(0);
                  setDragStartX(null);
                }}
                className="touch-pan-y select-none"
              >
                <CandidatePosterStage
                  candidate={fixture.snapshot.currentCandidate}
                  badgeText={
                    dragOffsetPx > 25
                      ? "Release to LIKE"
                      : dragOffsetPx < -25
                        ? "Release to SKIP"
                        : "Round 1 · Active Card"
                  }
                  dragOffsetPx={reducedMotionPreview ? 0 : dragOffsetPx}
                />
              </div>

              {/* Explicit Accessible Action Bar (>= 48px touch target) */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => triggerSimulatedVote("SKIP")}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[var(--cm-skip)] px-4 py-3 text-sm font-bold text-[var(--cm-skip-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-skip)]"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                  <span>Skip Film</span>
                </button>
                <button
                  type="button"
                  onClick={() => triggerSimulatedVote("LIKE")}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[var(--cm-like)] px-4 py-3 text-sm font-bold text-[var(--cm-like-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-like)]"
                >
                  <Heart className="h-5 w-5" aria-hidden="true" />
                  <span>Like Film</span>
                </button>
              </div>

              {lastSwipePreview && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] px-3.5 py-2.5 text-xs font-medium text-[var(--cm-ink)]"
                >
                  Recorded intent <span className="font-mono font-bold">{lastSwipePreview}</span>{" "}
                  with idempotent operationId{" "}
                  <span className="font-mono">vote:round-01:cand-04-interstellar</span>.
                  Awaiting server ack — never assuming optimistic MATCHED.
                </div>
              )}
            </div>
          )}

          {/* 5. VOTE-WAIT STATE */}
          {activeState === "vote-wait" && fixture.snapshot.currentCandidate && (
            <div className="space-y-4">
              <ConnectionStatusBanner status={fixture.realtimeStatus} />

              <div
                role="status"
                aria-live="polite"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--cm-like)]/40 bg-[var(--cm-like-soft-bg)] px-4 py-3 text-[var(--cm-like-soft-ink)]"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold">
                      Your immutable vote is locked: LIKE
                    </p>
                    <p className="text-xs">
                      Waiting for 1 remaining frozen participant before advancing.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-[var(--cm-surface)] px-3 py-1 font-mono text-xs font-bold text-[var(--cm-ink)] tabular-nums">
                  3 / 4 votes
                </span>
              </div>

              <CandidatePosterStage
                candidate={fixture.snapshot.currentCandidate}
                badgeText="Vote Locked: LIKE"
              />

              <ParticipantRosterList
                participants={fixture.snapshot.participants}
                maxParticipants={fixture.snapshot.maxParticipants}
                votedCount={3}
                compact
              />

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[var(--cm-border)]/40 bg-[var(--cm-surface-subtle)] px-4 py-3 text-sm font-semibold text-[var(--cm-ink-muted)] opacity-60"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span>Skip (Locked)</span>
                </button>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[var(--cm-like)]/40 bg-[var(--cm-like-soft-bg)] px-4 py-3 text-sm font-semibold text-[var(--cm-like-soft-ink)] opacity-80"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Liked (Immutable)</span>
                </button>
              </div>
            </div>
          )}

          {/* 6. MATCH STATE */}
          {activeState === "match" && fixture.snapshot.matchedCandidate && (
            <section
              role="region"
              aria-labelledby="cm-match-heading"
              className="space-y-4"
            >
              <div className="rounded-xl border-2 border-[var(--cm-match-gold-border)] bg-[var(--cm-match-gold-bg)] p-4 text-[var(--cm-match-gold-ink)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <h3
                      id="cm-match-heading"
                      className="text-lg font-extrabold tracking-tight"
                    >
                      IT&apos;S A MATCH! — {fixture.snapshot.matchedCandidate.title}
                    </h3>
                  </div>
                  <span className="rounded-full border border-current/35 px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums">
                    4 / 4 UNANIMOUS
                  </span>
                </div>
                <p className="mt-1 text-xs font-medium">
                  All frozen participants voted LIKE on the exact same film.
                </p>
              </div>

              <CandidatePosterStage
                candidate={fixture.snapshot.matchedCandidate}
                badgeText="Unanimous Pick"
                isMatched
              />

              <div className="rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] p-3.5 text-xs text-[var(--cm-ink-muted)]">
                <strong className="text-[var(--cm-ink)]">TMDB Compliance Note:</strong>{" "}
                Film metadata provided via TMDB. Streaming availability varies by region
                and is never inferred or fabricated client-side.
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopyMatchShare}
                  className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--cm-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--cm-brand-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  <span>Copy Match Title</span>
                </button>
                <Link
                  href={`/movie/${fixture.snapshot.matchedCandidate.movieId}`}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--cm-ink)] hover:bg-[var(--cm-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                >
                  <Film className="h-4 w-4" aria-hidden="true" />
                  <span>View Film Details</span>
                </Link>
              </div>

              {shareNote && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-xs font-medium text-[var(--cm-like-soft-ink)]"
                >
                  {shareNote}
                </p>
              )}
            </section>
          )}

          {/* 7. NO-MATCH / FINISH STATES */}
          {activeState === "no-match" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["DECK_EXHAUSTED", "Deck Exhausted"],
                    ["ROUND_CANCELLED", "90s Grace Cancelled"],
                    ["ROOM_EXPIRED", "24h Room Expired"],
                  ] as const
                ).map(([variant, title]) => (
                  <button
                    key={variant}
                    type="button"
                    aria-pressed={noMatchVariant === variant}
                    onClick={() => setNoMatchVariant(variant)}
                    className={cn(
                      "min-h-[44px] rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]",
                      noMatchVariant === variant
                        ? "border-[var(--cm-brand)] bg-[var(--cm-brand)] text-[var(--cm-brand-ink)]"
                        : "border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] text-[var(--cm-ink)]"
                    )}
                  >
                    {title}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-[var(--cm-border)]/50 bg-[var(--cm-surface-subtle)] p-5 space-y-2">
                <span className="inline-block rounded-md border border-[var(--cm-border)]/50 bg-[var(--cm-surface)] px-2 py-0.5 font-mono text-xs font-semibold text-[var(--cm-ink)]">
                  {fixture.snapshot.finishState.code}
                </span>
                <h3 className="text-lg font-bold text-[var(--cm-ink)]">
                  {noMatchVariant === "DECK_EXHAUSTED"
                    ? "No unanimous match this round"
                    : noMatchVariant === "ROUND_CANCELLED"
                      ? "Round paused and returned to lobby"
                      : "Screening room expired"}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--cm-ink-muted)]">
                  {fixture.snapshot.finishState.message}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {noMatchVariant === "DECK_EXHAUSTED" &&
                  (effectiveCanRetry ? (
                    <button
                      type="button"
                      onClick={() => setActiveState("swipe")}
                      className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--cm-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--cm-brand-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      <span>Start Fresh 20-Film Round</span>
                    </button>
                  ) : (
                    <div
                      role="status"
                      className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] px-4 py-2 text-sm font-medium text-[var(--cm-ink)]"
                    >
                      Waiting for host to retry or adjust filters...
                    </div>
                  ))}

                {noMatchVariant === "ROUND_CANCELLED" && (
                  <button
                    type="button"
                    onClick={() => setActiveState("lobby")}
                    className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-[var(--cm-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--cm-brand-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                  >
                    Return to Lobby Roster
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActiveState("create")}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--cm-ink)] hover:bg-[var(--cm-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
                >
                  Create New Room
                </button>
              </div>
            </div>
          )}

          {/* 8. ERROR STATE */}
          {activeState === "error" && (
            <div className="space-y-4">
              <CineMatchAlertCard
                code={fixture.errorSample.code}
                message={fixture.errorSample.message}
                retryAfterSeconds={fixture.errorSample.retryAfterSeconds}
                onRetry={handleSimulatedResync}
              />

              <div className="rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] p-4 text-xs text-[var(--cm-ink-muted)] space-y-1">
                <p className="font-semibold text-[var(--cm-ink)]">
                  Distinct from Loading State
                </p>
                <p>
                  Error alerts always render inside a dedicated{" "}
                  <code className="font-mono">[role=&quot;alert&quot;]</code> container
                  (never overlapping <code className="font-mono">#__next-route-announcer__</code>),
                  preserve user context, and never show infinite loading skeletons.
                </p>
              </div>

              {resyncPulse && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-xs font-semibold text-[var(--cm-like-soft-ink)]"
                >
                  Authoritative snapshot resync requested.
                </p>
              )}
            </div>
          )}

          {/* 9. OFFLINE / RECONNECTING STATE */}
          {activeState === "offline" && fixture.snapshot.currentCandidate && (
            <div className="space-y-4">
              <ConnectionStatusBanner
                status={fixture.realtimeStatus}
                isOffline
                onResync={handleSimulatedResync}
                resyncing={resyncPulse}
              />

              <div className="opacity-85">
                <CandidatePosterStage
                  candidate={fixture.snapshot.currentCandidate}
                  badgeText="Paused Offline"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-offline-bg)] px-4 py-3 text-sm font-semibold text-[var(--cm-offline-ink)] opacity-75"
                >
                  <WifiOff className="h-4 w-4" aria-hidden="true" />
                  <span>Skip (Offline)</span>
                </button>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-offline-bg)] px-4 py-3 text-sm font-semibold text-[var(--cm-offline-ink)] opacity-75"
                >
                  <WifiOff className="h-4 w-4" aria-hidden="true" />
                  <span>Like (Offline)</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Contract Mapping & Accessibility / Contrast Inspector */}
        <aside className="min-w-0 space-y-4 lg:col-span-5">
          <div className="rounded-2xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface)] p-4 shadow-sm sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--cm-brand-text)]" aria-hidden="true" />
              <h2 className="text-base font-bold text-[var(--cm-ink)]">
                Contract Mapping · {contract.shortTitle}
              </h2>
            </div>

            <dl className="space-y-2 text-xs">
              <div className="rounded-lg bg-[var(--cm-surface-subtle)] p-2.5">
                <dt className="font-semibold text-[var(--cm-ink)]">
                  Backend Endpoint / Action
                </dt>
                <dd className="mt-0.5 break-words font-mono text-[var(--cm-ink-muted)]">
                  {contract.backendMapping.endpointOrAction}
                </dd>
              </div>
              <div className="rounded-lg bg-[var(--cm-surface-subtle)] p-2.5">
                <dt className="font-semibold text-[var(--cm-ink)]">
                  Primary Goal
                </dt>
                <dd className="mt-0.5 text-[var(--cm-ink-muted)]">
                  {contract.primaryGoal}
                </dd>
              </div>
            </dl>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--cm-ink-muted)]">
                Required UI Elements
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-[var(--cm-ink)]">
                {contract.requiredElements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--cm-ink-muted)]">
                Keyboard &amp; ARIA Contract
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-[var(--cm-ink)]">
                {contract.keyboardContract.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                <li>{contract.ariaContract}</li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--cm-skip-soft-ink)]">
                Prohibited Patterns
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-[var(--cm-ink-muted)]">
                {contract.prohibitedPatterns.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Live WCAG AA Contrast Matrix */}
          <div className="rounded-2xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface)] p-4 shadow-sm sm:p-5 space-y-3">
            <h2 className="text-base font-bold text-[var(--cm-ink)]">
              WCAG 2.1 Contrast Audit (Light &amp; Dark)
            </h2>
            <p className="text-xs text-[var(--cm-ink-muted)]">
              Computed live from CineMatch tokens (&ge; 4.5:1 text, &ge; 3.0:1 UI
              borders).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--cm-border)]/40 text-[var(--cm-ink-muted)]">
                    <th className="py-1.5 pr-2 font-semibold">Token Pair</th>
                    <th className="px-2 py-1.5 font-semibold">Light</th>
                    <th className="pl-2 py-1.5 font-semibold">Dark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--cm-border)]/25">
                  {lightContrast.map((lightPair, idx) => {
                    const darkPair = darkContrast[idx];
                    return (
                      <tr key={lightPair.id}>
                        <td className="py-1.5 pr-2 font-medium text-[var(--cm-ink)]">
                          {lightPair.label}
                        </td>
                        <td className="px-2 py-1.5 font-mono tabular-nums text-[var(--cm-like-soft-ink)]">
                          {lightPair.ratio}:1
                        </td>
                        <td className="pl-2 py-1.5 font-mono tabular-nums text-[var(--cm-like-soft-ink)]">
                          {darkPair.ratio}:1
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
