"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Film,
  Link2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { RealtimeStatus } from "@/lib/realtime/roomRealtime";
import type { SafeDeckCandidate } from "@/lib/schemas/roomDeck";
import type { SafeRoomParticipant } from "@/lib/server/room/roomSnapshot";
import { cn } from "@/lib/utils";

export type ClipboardCopyResult =
  | { ok: true }
  | { ok: false; reason: "UNAVAILABLE" | "REJECTED" };

/**
 * Writes text to the browser clipboard and returns a strict pass/fail outcome
 * so callers never report false copy success when the API is unavailable or rejected.
 */
export async function copyTextToClipboard(
  text: string
): Promise<ClipboardCopyResult> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.writeText !== "function"
  ) {
    return { ok: false, reason: "UNAVAILABLE" };
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, reason: "REJECTED" };
  }
}

interface ConnectionStatusBannerProps {
  status: RealtimeStatus;
  isOffline?: boolean;
  onResync?: () => void;
  resyncing?: boolean;
}

export function ConnectionStatusBanner({
  status,
  isOffline = false,
  onResync,
  resyncing = false,
}: ConnectionStatusBannerProps) {
  const effectiveMode = isOffline ? "offline" : status;

  const config: Record<
    string,
    {
      label: string;
      detail: string;
      bg: string;
      ink: string;
      border: string;
      icon: typeof Wifi;
    }
  > = {
    live: {
      label: "Live",
      detail: "Realtime room channel connected",
      bg: "bg-[var(--cm-like-soft-bg)]",
      ink: "text-[var(--cm-like-soft-ink)]",
      border: "border-[var(--cm-like)]/35",
      icon: Wifi,
    },
    connecting: {
      label: "Connecting",
      detail: "Opening room realtime channel...",
      bg: "bg-[var(--cm-warning-bg)]",
      ink: "text-[var(--cm-warning-ink)]",
      border: "border-[var(--cm-match-gold-border)]/40",
      icon: RefreshCw,
    },
    reconnecting: {
      label: "Reconnecting",
      detail: "Resyncing snapshot with room authority...",
      bg: "bg-[var(--cm-warning-bg)]",
      ink: "text-[var(--cm-warning-ink)]",
      border: "border-[var(--cm-match-gold-border)]/45",
      icon: RefreshCw,
    },
    degraded: {
      label: "Polling Fallback",
      detail: "Realtime degraded — polling authoritative snapshot every 15s",
      bg: "bg-[var(--cm-warning-bg)]",
      ink: "text-[var(--cm-warning-ink)]",
      border: "border-[var(--cm-match-gold-border)]/50",
      icon: AlertTriangle,
    },
    closed: {
      label: "Disconnected",
      detail: "Room channel closed — reconnect to resume voting",
      bg: "bg-[var(--cm-offline-bg)]",
      ink: "text-[var(--cm-offline-ink)]",
      border: "border-[var(--cm-border)]",
      icon: WifiOff,
    },
    offline: {
      label: "Offline",
      detail: "No network connection — actions pause safely until back online",
      bg: "bg-[var(--cm-offline-bg)]",
      ink: "text-[var(--cm-offline-ink)]",
      border: "border-[var(--cm-border)]",
      icon: WifiOff,
    },
  };

  const c = config[effectiveMode] ?? config.live;
  const Icon = c.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="cm-connection-banner"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm",
        c.bg,
        c.ink,
        c.border
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <span className="font-semibold">{c.label}:</span>{" "}
          <span className="break-words">{c.detail}</span>
        </div>
      </div>
      {onResync && effectiveMode !== "live" && (
        <button
          type="button"
          onClick={onResync}
          disabled={resyncing}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-current/25 bg-[var(--cm-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--cm-ink)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand)] disabled:opacity-60"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", resyncing && "animate-spin")}
            aria-hidden="true"
          />
          <span>{resyncing ? "Resyncing..." : "Reconnect & Resync"}</span>
        </button>
      )}
    </div>
  );
}

interface RoomCodeChipProps {
  code: string;
  invitePath: string;
}

type RoomCodeCopyState =
  | { status: "idle" }
  | { status: "copied"; target: "code" | "link" }
  | {
      status: "error";
      target: "code" | "link";
      value: string;
      reason: "UNAVAILABLE" | "REJECTED";
    };

export function RoomCodeChip({ code, invitePath }: RoomCodeChipProps) {
  const [copyState, setCopyState] = useState<RoomCodeCopyState>({ status: "idle" });
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const scheduleReset = (delayMs: number) => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setCopyState({ status: "idle" });
    }, delayMs);
  };

  const handleCopy = async (type: "code" | "link") => {
    const value =
      type === "code"
        ? code
        : typeof window !== "undefined"
          ? `${window.location.origin}${invitePath}`
          : invitePath;
    const result = await copyTextToClipboard(value);
    if (result.ok) {
      setCopyState({ status: "copied", target: type });
      scheduleReset(2000);
      return;
    }

    setCopyState({
      status: "error",
      target: type,
      value,
      reason: result.reason,
    });
    scheduleReset(5000);
  };

  const copiedTarget = copyState.status === "copied" ? copyState.target : null;

  return (
    <div className="space-y-2.5 rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--cm-ink-muted)]">
            Room Code
          </p>
          <p
            data-testid="cm-room-code"
            className="font-mono text-2xl font-bold tracking-[0.18em] text-[var(--cm-ink)] tabular-nums"
          >
            {code}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopy("code")}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--cm-border)]/60 bg-[var(--cm-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--cm-ink)] hover:bg-[var(--cm-surface-elevated)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
          >
            {copiedTarget === "code" ? (
              <Check className="h-3.5 w-3.5 text-[var(--cm-like)]" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{copiedTarget === "code" ? "Code Copied" : "Copy Code"}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCopy("link")}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[var(--cm-brand)] px-3.5 py-2 text-xs font-semibold text-[var(--cm-brand-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
          >
            {copiedTarget === "link" ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{copiedTarget === "link" ? "Invite Copied" : "Copy Invite Link"}</span>
          </button>
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        {copiedTarget === "code"
          ? `Room code ${code} copied.`
          : copiedTarget === "link"
            ? "Invite link copied."
            : ""}
      </span>

      {copyState.status === "error" && (
        <div
          role="alert"
          data-testid="cm-copy-error"
          className="rounded-lg border border-[var(--cm-skip)]/40 bg-[var(--cm-skip-soft-bg)] px-3 py-2 text-xs text-[var(--cm-skip-soft-ink)]"
        >
          <span className="font-semibold">
            {copyState.reason === "UNAVAILABLE"
              ? "Clipboard is unavailable in this browser."
              : "Clipboard permission was denied."}
          </span>{" "}
          Copy {copyState.target === "code" ? "room code" : "invite link"} manually:{" "}
          <code className="select-all font-mono font-bold break-all">
            {copyState.value}
          </code>
        </div>
      )}
    </div>
  );
}

interface ParticipantRosterListProps {
  participants: SafeRoomParticipant[];
  maxParticipants: number;
  votedCount?: number;
  compact?: boolean;
}

export function ParticipantRosterList({
  participants,
  maxParticipants,
  votedCount,
  compact = false,
}: ParticipantRosterListProps) {
  return (
    <section
      aria-label="Room participants"
      className="rounded-xl border border-[var(--cm-border)]/45 bg-[var(--cm-surface-subtle)] p-3.5"
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[var(--cm-ink-muted)]" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--cm-ink)]">
            Screening Roster ({participants.length}/{maxParticipants})
          </h3>
        </div>
        {typeof votedCount === "number" && (
          <span className="rounded-full bg-[var(--cm-surface)] px-2.5 py-0.5 font-mono text-xs font-semibold text-[var(--cm-ink)] tabular-nums border border-[var(--cm-border)]/40">
            {votedCount}/{participants.length} voted
          </span>
        )}
      </div>

      <ul
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
        )}
      >
        {participants.map((member, index) => (
          <li
            key={`${member.displayName}-${member.joinedAt}-${index}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--cm-border)]/35 bg-[var(--cm-surface)] px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  member.role === "HOST"
                    ? "bg-[var(--cm-brand)] text-[var(--cm-brand-ink)]"
                    : "bg-[var(--cm-surface-subtle)] text-[var(--cm-ink)] border border-[var(--cm-border)]/40"
                )}
                aria-hidden="true"
              >
                {member.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--cm-ink)]">
                  {member.displayName}
                  {member.isSelf ? " (You)" : ""}
                </p>
                <p className="text-xs text-[var(--cm-ink-muted)]">
                  {member.role === "HOST" ? "Host" : "Guest"}
                </p>
              </div>
            </div>

            {member.isConnected ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--cm-like-soft-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--cm-like-soft-ink)]">
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                Connected
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--cm-warning-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--cm-warning-ink)]">
                <Clock className="h-3 w-3" aria-hidden="true" />
                Grace 90s
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface CineMatchAlertCardProps {
  code: string;
  message: string;
  retryAfterSeconds?: number;
  onRetry?: () => void;
}

export function CineMatchAlertCard({
  code,
  message,
  retryAfterSeconds,
  onRetry,
}: CineMatchAlertCardProps) {
  return (
    <div
      role="alert"
      data-testid="cm-scoped-alert"
      className="rounded-xl border border-[var(--cm-skip)]/45 bg-[var(--cm-skip-soft-bg)] p-4 text-[var(--cm-skip-soft-ink)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="text-sm font-bold">Action could not complete</span>
            <span className="rounded-md border border-current/30 px-1.5 py-0.5 font-mono text-[11px] font-semibold">
              {code}
            </span>
          </div>
          <p className="text-sm leading-relaxed">{message}</p>
          {typeof retryAfterSeconds === "number" && retryAfterSeconds > 0 && (
            <p className="font-mono text-xs font-semibold tabular-nums">
              Server Retry-After window: {retryAfterSeconds}s
            </p>
          )}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-[var(--cm-skip)] px-4 py-2 text-xs font-semibold text-[var(--cm-skip-ink)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-skip)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Resync Room State</span>
          </button>
        )}
      </div>
    </div>
  );
}

interface CandidatePosterStageProps {
  candidate: SafeDeckCandidate;
  badgeText?: string;
  isMatched?: boolean;
  dragOffsetPx?: number;
}

export function CandidatePosterStage({
  candidate,
  badgeText,
  isMatched = false,
  dragOffsetPx = 0,
}: CandidatePosterStageProps) {
  const [expanded, setExpanded] = useState(false);
  const year = candidate.releaseDate ? candidate.releaseDate.slice(0, 4) : "TBA";
  const rating =
    typeof candidate.voteAverage === "number"
      ? candidate.voteAverage.toFixed(1)
      : "NR";
  const rotationDeg = Math.max(-6, Math.min(6, dragOffsetPx * 0.04));

  return (
    <article
      aria-label={`${candidate.title} (${year})`}
      style={
        dragOffsetPx !== 0
          ? {
              transform: `translateX(${dragOffsetPx}px) rotate(${rotationDeg}deg)`,
            }
          : undefined
      }
      className={cn(
        "cm-motion-surface relative overflow-hidden rounded-2xl border bg-[var(--cm-surface-elevated)] shadow-lg",
        isMatched
          ? "cm-match-glow border-2 border-[var(--cm-match-gold-border)]"
          : "border-[var(--cm-border)]/50"
      )}
    >
      {/* 2:3 / 4:3 Poster Backdrop Area */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-[#1b1235] via-[#271b4a] to-[#0d1829] sm:aspect-[16/9]">
        {candidate.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={candidate.posterUrl}
            alt={candidate.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-6 pb-20 pt-12 text-center text-white/90"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/25 bg-white/10">
              <Film className="h-6 w-6 text-amber-300" />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
              TMDB Screening Poster
            </p>
            <p className="font-mono text-[11px] text-white/75">
              ID #{candidate.movieId} · {year}
            </p>
          </div>
        )}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent"
        />

        {badgeText && (
          <div className="absolute left-3.5 top-3.5 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/75 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm">
            {isMatched ? (
              <Sparkles className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
            )}
            <span>{badgeText}</span>
          </div>
        )}

        <div className="absolute bottom-3.5 left-4 right-4 text-white">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white/90">
            <span className="rounded bg-white/20 px-2 py-0.5 font-mono tabular-nums">
              {year}
            </span>
            <span className="rounded bg-amber-400/25 px-2 py-0.5 font-mono text-amber-200 tabular-nums">
              TMDB {rating}
            </span>
          </div>
          <h3 className="mt-1.5 text-xl font-bold leading-tight sm:text-2xl">
            {candidate.title}
          </h3>
        </div>
      </div>

      {/* High-Contrast Synopsis Footer */}
      <div className="space-y-2.5 p-4">
        <p
          className={cn(
            "text-sm leading-relaxed text-[var(--cm-ink-muted)]",
            !expanded && "line-clamp-3"
          )}
        >
          {candidate.overview ?? "No synopsis available for this film."}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-xs font-semibold text-[var(--cm-brand-text)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]"
        >
          {expanded ? "Show less synopsis" : "More details & full synopsis"}
        </button>
      </div>
    </article>
  );
}
