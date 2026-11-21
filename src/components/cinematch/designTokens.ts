import type { RoomStatus } from "@/db/schema";
import type { RealtimeStatus } from "@/lib/realtime/roomRealtime";
import type { RoomFinishState } from "@/lib/server/room/finishPolicy";
import type { SafeDeckCandidate } from "@/lib/schemas/roomDeck";
import type {
  RoomSessionViewer,
  SafeRoomParticipant,
  SafeRoomSnapshot,
} from "@/lib/server/room/roomSnapshot";

export type CineMatchScreenStateId =
  | "create"
  | "join"
  | "lobby"
  | "swipe"
  | "vote-wait"
  | "match"
  | "no-match"
  | "error"
  | "offline";

export type CineMatchThemeMode = "light" | "dark";

export interface ContrastPairSpec {
  id: string;
  label: string;
  foregroundHex: string;
  backgroundHex: string;
  minRatio: number;
  usage: string;
}

export const CINEMATCH_THEME_PALETTES: Record<
  CineMatchThemeMode,
  Record<string, string>
> = {
  light: {
    surface: "#ffffff",
    surfaceSubtle: "#f5f4f8",
    surfaceElevated: "#fbfafc",
    ink: "#141122",
    inkMuted: "#4a4563",
    border: "#6e6889",
    brand: "#5b21b6",
    brandInk: "#ffffff",
    brandText: "#5b21b6",
    like: "#065f46",
    likeInk: "#ffffff",
    likeSoftBg: "#ecfdf5",
    likeSoftInk: "#065f46",
    skip: "#be123c",
    skipInk: "#ffffff",
    skipSoftBg: "#fff1f2",
    skipSoftInk: "#9f1239",
    matchGoldBg: "#fef3c7",
    matchGoldInk: "#78350f",
    matchGoldBorder: "#92400e",
    warningBg: "#fffbeb",
    warningInk: "#92400e",
    offlineBg: "#f1f5f9",
    offlineInk: "#1e293b",
  },
  dark: {
    surface: "#12111a",
    surfaceSubtle: "#1b1926",
    surfaceElevated: "#232033",
    ink: "#f5f4f8",
    inkMuted: "#c4bfd9",
    border: "#8c86a8",
    brand: "#6d28d9",
    brandInk: "#ffffff",
    brandText: "#c4b5fd",
    like: "#065f46",
    likeInk: "#ffffff",
    likeSoftBg: "#064e3b",
    likeSoftInk: "#a7f3d0",
    skip: "#be123c",
    skipInk: "#ffffff",
    skipSoftBg: "#4c0519",
    skipSoftInk: "#fecdd3",
    matchGoldBg: "#451a03",
    matchGoldInk: "#fde68a",
    matchGoldBorder: "#f59e0b",
    warningBg: "#422006",
    warningInk: "#fde68a",
    offlineBg: "#1e293b",
    offlineInk: "#e2e8f0",
  },
};

export function getThemeContrastPairs(
  mode: CineMatchThemeMode
): ContrastPairSpec[] {
  const p = CINEMATCH_THEME_PALETTES[mode];
  return [
    {
      id: `${mode}-body-text`,
      label: "Primary text on surface",
      foregroundHex: p.ink,
      backgroundHex: p.surface,
      minRatio: 4.5,
      usage: "Headings, body copy, movie titles",
    },
    {
      id: `${mode}-muted-text`,
      label: "Muted text on subtle surface",
      foregroundHex: p.inkMuted,
      backgroundHex: p.surfaceSubtle,
      minRatio: 4.5,
      usage: "Helper labels, metadata, timestamps",
    },
    {
      id: `${mode}-brand-cta`,
      label: "Primary CTA label on brand violet",
      foregroundHex: p.brandInk,
      backgroundHex: p.brand,
      minRatio: 4.5,
      usage: "Create room, Start round, Retry round buttons",
    },
    {
      id: `${mode}-brand-link`,
      label: "Accent link text on surface",
      foregroundHex: p.brandText,
      backgroundHex: p.surface,
      minRatio: 4.5,
      usage: "Inline expandable details & eyebrow labels",
    },
    {
      id: `${mode}-like-cta`,
      label: "LIKE button label on emerald fill",
      foregroundHex: p.likeInk,
      backgroundHex: p.like,
      minRatio: 4.5,
      usage: "Swipe Like button and unanimous confirm action",
    },
    {
      id: `${mode}-skip-cta`,
      label: "SKIP button label on crimson fill",
      foregroundHex: p.skipInk,
      backgroundHex: p.skip,
      minRatio: 4.5,
      usage: "Swipe Skip button and destructive leave confirmation",
    },
    {
      id: `${mode}-like-badge`,
      label: "Live / Like status badge",
      foregroundHex: p.likeSoftInk,
      backgroundHex: p.likeSoftBg,
      minRatio: 4.5,
      usage: "Connected badge, Live realtime chip, Like pill",
    },
    {
      id: `${mode}-skip-badge`,
      label: "Error / Skip status badge",
      foregroundHex: p.skipSoftInk,
      backgroundHex: p.skipSoftBg,
      minRatio: 4.5,
      usage: "Error alert surface, Skip badge, Closed/Denied status",
    },
    {
      id: `${mode}-match-banner`,
      label: "Match reveal marquee badge",
      foregroundHex: p.matchGoldInk,
      backgroundHex: p.matchGoldBg,
      minRatio: 4.5,
      usage: "IT'S A MATCH reveal banner and quorum badge",
    },
    {
      id: `${mode}-warning-banner`,
      label: "Reconnecting / Grace warning banner",
      foregroundHex: p.warningInk,
      backgroundHex: p.warningBg,
      minRatio: 4.5,
      usage: "Reconnecting / degraded / 90s grace timer alert",
    },
    {
      id: `${mode}-offline-banner`,
      label: "Offline status banner",
      foregroundHex: p.offlineInk,
      backgroundHex: p.offlineBg,
      minRatio: 4.5,
      usage: "Network offline / paused input banner",
    },
    {
      id: `${mode}-ui-border`,
      label: "Interactive control border on surface",
      foregroundHex: p.border,
      backgroundHex: p.surface,
      minRatio: 3.0,
      usage: "Input outlines, card boundaries, focus rings (WCAG 1.4.11)",
    },
  ];
}

function channelRelativeLuminance(channel8Bit: number): number {
  const srgb = channel8Bit / 255;
  return srgb <= 0.03928
    ? srgb / 12.92
    : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

export function hexToRelativeLuminance(hex: string): number {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`Invalid 6-digit hex color: ${hex}`);
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (
    0.2126 * channelRelativeLuminance(r) +
    0.7152 * channelRelativeLuminance(g) +
    0.0722 * channelRelativeLuminance(b)
  );
}

export function computeWcagContrastRatio(
  foregroundHex: string,
  backgroundHex: string
): number {
  const l1 = hexToRelativeLuminance(foregroundHex);
  const l2 = hexToRelativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export interface CineMatchScreenContractSpec {
  id: CineMatchScreenStateId;
  label: string;
  shortTitle: string;
  routeOrEntry: string;
  backendMapping: {
    roomStatus: RoomStatus | "PRE_ROOM";
    finishCode: RoomFinishState["code"] | "PRE_ROOM" | "CLIENT_ERROR" | "OFFLINE";
    realtimeStatus: RealtimeStatus | "not_connected";
    endpointOrAction: string;
  };
  primaryGoal: string;
  requiredElements: readonly string[];
  keyboardContract: readonly string[];
  ariaContract: string;
  prohibitedPatterns: readonly string[];
}

export const CINEMATCH_SCREEN_CONTRACTS: readonly CineMatchScreenContractSpec[] = [
  {
    id: "create",
    label: "01 · Create Room",
    shortTitle: "Create",
    routeOrEntry: "/cinematch (Create tab) -> POST /api/rooms",
    backendMapping: {
      roomStatus: "PRE_ROOM",
      finishCode: "PRE_ROOM",
      realtimeStatus: "not_connected",
      endpointOrAction: "POST /api/rooms (createRoomWithSession)",
    },
    primaryGoal:
      "Host enters a 1–32 character display name, optionally previews deck filters, and opens a 2–5 guest screening room.",
    requiredElements: [
      "Display name input (max 32 chars, trimmed NFKC)",
      "Optional deck filter summary (include_adult strictly false)",
      "Primary CTA >= 44px height with distinct loading state",
      "Secondary switch to Join Room",
    ],
    keyboardContract: [
      "Tab moves from display name -> filter preset -> Create CTA -> Join tab",
      "Enter inside form submits when display name is valid",
    ],
    ariaContract:
      "Form uses associated <label>, aria-describedby for validation hints, and aria-busy during submission.",
    prohibitedPatterns: [
      "Never expose capability tokens in URL or DOM",
      "Never block creation behind an account login wall",
    ],
  },
  {
    id: "join",
    label: "02 · Join Room",
    shortTitle: "Join",
    routeOrEntry: "/cinematch?code=XXXXXX -> POST /api/rooms/join",
    backendMapping: {
      roomStatus: "PRE_ROOM",
      finishCode: "PRE_ROOM",
      realtimeStatus: "not_connected",
      endpointOrAction: "POST /api/rooms/join (joinRoomWithSession)",
    },
    primaryGoal:
      "Guest enters or pastes a 6-character room code (or full invite link) and display name to claim one of 2–5 lobby seats.",
    requiredElements: [
      "Monospace uppercase Room Code input (strips invite URLs/query strings cleanly)",
      "Guest display name input (1–32 chars)",
      "Distinct inline error slot for 404/409/410 without clearing user input",
      "Primary Join Room CTA >= 44px height",
    ],
    keyboardContract: [
      "Tab moves from room code -> display name -> Join CTA",
      "Enter submits join request once 6-char code and name are populated",
    ],
    ariaContract:
      "Room code input announces expected 6-character format via aria-describedby; errors render in a scoped role='alert'.",
    prohibitedPatterns: [
      "Never treat loading skeleton and error alert as identical UI",
      "Never retain secret tokens in parsed invite links",
    ],
  },
  {
    id: "lobby",
    label: "03 · Room Lobby",
    shortTitle: "Lobby",
    routeOrEntry: "SafeRoomSnapshot.status === 'LOBBY'",
    backendMapping: {
      roomStatus: "LOBBY",
      finishCode: "LOBBY_READY",
      realtimeStatus: "live",
      endpointOrAction:
        "GET /api/rooms/[roomId], PATCH /filters, POST /start, POST /leave",
    },
    primaryGoal:
      "Host and 2–5 guests verify who is connected, copy/share the room code or invite path, review common filters, and freeze the round roster on Start.",
    requiredElements: [
      "6-char Room Code badge in Geist Mono + Copy Code / Copy Invite Link actions",
      "2–5 participant roster showing displayName, role (HOST/MEMBER), connection state, and '(You)' marker",
      "Host-editable / guest-read-only deck filter summary",
      "Host-only 'Start Movie Night' CTA disabled until participantCount >= 2; Guest waiting indicator",
    ],
    keyboardContract: [
      "Tab reaches Copy Code -> Copy Link -> Filter controls (host) -> Start / Leave CTA",
      "Clipboard confirmation updates polite live region without stealing focus",
    ],
    ariaContract:
      "Roster list uses semantic <ul>/<li> with explicit connected/disconnected text labels (never color-only).",
    prohibitedPatterns: [
      "Never show an active Start button to non-host guests",
      "Never render peer participantId UUIDs in DOM or copy payloads",
    ],
  },
  {
    id: "swipe",
    label: "04 · Active Swipe",
    shortTitle: "Swipe",
    routeOrEntry: "SafeRoomSnapshot.status === 'ACTIVE' && nextCandidateIndex !== null",
    backendMapping: {
      roomStatus: "ACTIVE",
      finishCode: "ROUND_ACTIVE",
      realtimeStatus: "live",
      endpointOrAction:
        "createRoomActions().vote() -> POST /api/rooms/[roomId]/votes",
    },
    primaryGoal:
      "Voter reviews the current deterministic deck candidate and commits one immutable LIKE or SKIP vote via touch drag, pointer button, or keyboard.",
    requiredElements: [
      "Round progress indicator (e.g. Card 04 / 20, or shortage deck notice)",
      "2:3 movie poster with high-contrast bottom scrim, title, year, TMDB rating, overview",
      "Explicit Skip and Like buttons >= 48px height (above 44px minimum) with single-flight lock",
      "Live compact roster strip showing connected status",
    ],
    keyboardContract: [
      "ArrowLeft / S triggers Skip when card region or action bar is focused",
      "ArrowRight / L triggers Like when card region or action bar is focused",
      "Tab reaches Details toggle -> Skip button -> Like button",
    ],
    ariaContract:
      "Active card region exposes aria-label with movie title and position; Like/Skip buttons use clear accessible names.",
    prohibitedPatterns: [
      "Never show optimistic 'IT'S A MATCH' before server ack",
      "Never submit duplicate votes on rapid double-click or double-swipe",
    ],
  },
  {
    id: "vote-wait",
    label: "05 · Vote Wait",
    shortTitle: "Vote Wait",
    routeOrEntry:
      "SafeRoomSnapshot.status === 'ACTIVE' && currentCandidateId in viewer.userVotes",
    backendMapping: {
      roomStatus: "ACTIVE",
      finishCode: "ROUND_ACTIVE",
      realtimeStatus: "live",
      endpointOrAction:
        "Awaiting remaining frozenQuorum votes or 90s grace resolution",
    },
    primaryGoal:
      "Confirm the user's immutable vote is locked on the server while clearly showing which frozen participants are still voting or within a 90s reconnect grace window.",
    requiredElements: [
      "Immutable vote confirmation badge ('You voted LIKE' or 'You voted SKIP')",
      "Locked card thumbnail + title + round progress",
      "Frozen quorum waiting summary (e.g. '3 / 4 votes locked') and any 90s grace timer",
      "Disabled Like/Skip controls preventing duplicate or reversed votes",
    ],
    keyboardContract: [
      "Focus stays on wait status container or passive controls; disabled vote buttons remain non-interactive",
      "Resync / Refresh Snapshot button remains keyboard-reachable",
    ],
    ariaContract:
      "aria-live='polite' region announces when remaining voters complete or if a member disconnects into grace.",
    prohibitedPatterns: [
      "Never allow changing or re-submitting an already recorded vote",
      "Never silently shrink frozenQuorum mid-round",
    ],
  },
  {
    id: "match",
    label: "06 · Unanimous Match",
    shortTitle: "Match",
    routeOrEntry: "SafeRoomSnapshot.status === 'MATCHED'",
    backendMapping: {
      roomStatus: "MATCHED",
      finishCode: "MATCH_FOUND",
      realtimeStatus: "live",
      endpointOrAction: "Authoritative MATCHED snapshot with matchedCandidate",
    },
    primaryGoal:
      "Deliver the celebratory 'IT'S A MATCH' reveal with provider-safe TMDB metadata, unanimous quorum proof, and sanitized sharing.",
    requiredElements: [
      "Marquee 'IT'S A MATCH' header (gold/amber badge with static fallback under reduced motion)",
      "Matched movie poster, title, release year, TMDB rating, overview",
      "Explicit TMDB attribution & neutral availability note (never inventing streaming providers)",
      "Sanitized Share / Copy Title button and Browse Film Details link",
    ],
    keyboardContract: [
      "Focus moves smoothly to Match Reveal heading or remains navigable from Copy Title -> Browse Details -> New Room",
    ],
    ariaContract:
      "Match reveal container uses role='region' with aria-labelledby pointing to 'It's a Match: <Title>'.",
    prohibitedPatterns: [
      "Never invent or hardcode Netflix/Prime/Disney streaming availability",
      "Never embed guest capability tokens or internal participantIds in share payloads",
    ],
  },
  {
    id: "no-match",
    label: "07 · No Match / Round Ended",
    shortTitle: "No Match",
    routeOrEntry:
      "finishState.code in ['DECK_EXHAUSTED', 'ROUND_CANCELLED', 'ROOM_EXPIRED']",
    backendMapping: {
      roomStatus: "EXHAUSTED",
      finishCode: "DECK_EXHAUSTED",
      realtimeStatus: "live",
      endpointOrAction:
        "POST /api/rooms/[roomId]/retry (host) or return to Create/Join",
    },
    primaryGoal:
      "Resolve non-matching, grace-cancelled, or expired rounds gracefully with clear explanation and host-authorized round retry or new-room exit.",
    requiredElements: [
      "Clear outcome heading distinguishing Exhausted Deck vs Grace-Cancelled Round vs 24h Room Expired",
      "Host 'Retry New Deck' / 'Adjust Filters in Lobby' CTAs when retryAvailable === true",
      "Guest calm status note ('Host can start a fresh 20-film deck') when non-host",
      "Create New Room fallback when room is EXPIRED (recoverable === false)",
    ],
    keyboardContract: [
      "Tab cycles cleanly through Retry Round / Adjust Filters (host) -> Leave / New Room CTA",
    ],
    ariaContract:
      "Outcome region announces state clearly without alarming red error styling for normal EXHAUSTED completions.",
    prohibitedPatterns: [
      "Never present normal DECK_EXHAUSTED as a broken 500 crash",
      "Never show Retry CTA when finishState.retryAvailable === false",
    ],
  },
  {
    id: "error",
    label: "08 · Recoverable Error",
    shortTitle: "Error",
    routeOrEntry: "RoomActionFailure | HTTP 4xx/5xx API rejection",
    backendMapping: {
      roomStatus: "ACTIVE",
      finishCode: "CLIENT_ERROR",
      realtimeStatus: "live",
      endpointOrAction:
        "createRoomActions() failure -> options.resync() or user retry",
    },
    primaryGoal:
      "Communicate actionable, plain-language failure recovery (stale snapshot, rate limit Retry-After, capacity full, invalid filter) distinctly from loading states.",
    requiredElements: [
      "Scoped role='alert' container (distinct from #__next-route-announcer__)",
      "Human-readable reason + machine error code badge (e.g. DECK_EMPTY, RATE_LIMITED)",
      "Recovery CTA ('Resync Room State', 'Edit Filters', or 'Retry in Xs')",
    ],
    keyboardContract: [
      "Recovery button is immediately reachable via Tab (>= 44px hit area)",
    ],
    ariaContract:
      "Alert banner uses role='alert' inside the CineMatch stage without colliding with Next.js route announcer.",
    prohibitedPatterns: [
      "Never leak stack traces, SQL errors, or capability/TMDB secrets",
      "Never render an infinite spinner instead of an error state",
    ],
  },
  {
    id: "offline",
    label: "09 · Offline / Reconnecting",
    shortTitle: "Offline",
    routeOrEntry:
      "RealtimeStatus in ['reconnecting', 'degraded', 'closed'] or navigator.onLine === false",
    backendMapping: {
      roomStatus: "ACTIVE",
      finishCode: "OFFLINE",
      realtimeStatus: "degraded",
      endpointOrAction:
        "roomRealtime.resync() + 15s snapshot poll + wake listeners",
    },
    primaryGoal:
      "Preserve the active screen context while clearly signalling realtime reconnect, 15s polling fallback, or network offline status with safe input gating.",
    requiredElements: [
      "Top status banner distinguishing Reconnecting vs Degraded (15s poll) vs Offline",
      "Preserved current card/lobby context (never wipes screen to blank error page)",
      "Disabled vote/start submissions while offline with explanatory helper text",
      "Manual 'Reconnect & Resync' button >= 44px height",
    ],
    keyboardContract: [
      "Tab reaches Reconnect & Resync button without focus traps",
    ],
    ariaContract:
      "Connection banner uses role='status' and aria-live='polite' so transient drops do not interrupt screen-reader reading.",
    prohibitedPatterns: [
      "Never fire unqueued vote requests while disconnected without idempotent operationId",
      "Never claim 'Live' when RealtimeStatus is reconnecting/degraded/closed",
    ],
  },
];

export interface CineMatchContractFixture {
  snapshot: SafeRoomSnapshot;
  viewer: RoomSessionViewer;
  realtimeStatus: RealtimeStatus;
  errorSample: {
    code: string;
    status: number;
    message: string;
    retryAfterSeconds?: number;
  };
  noMatchVariant: "DECK_EXHAUSTED" | "ROUND_CANCELLED" | "ROOM_EXPIRED";
}

const SAMPLE_CANDIDATE_ACTIVE: SafeDeckCandidate = {
  candidateId: "cand-04-interstellar",
  position: 3,
  movieId: 157336,
  title: "Interstellar",
  posterPath: "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
  posterUrl: null,
  overview:
    "The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel and conquer the vast distances involved in an interstellar voyage.",
  releaseDate: "2014-11-05",
  voteAverage: 8.4,
};

const SAMPLE_CANDIDATE_MATCHED: SafeDeckCandidate = {
  candidateId: "cand-07-inception",
  position: 6,
  movieId: 27205,
  title: "Inception",
  posterPath: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
  posterUrl: null,
  overview:
    "Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets is offered a chance to regain his old life as payment for a task considered to be impossible.",
  releaseDate: "2010-07-15",
  voteAverage: 8.4,
};

const BASE_PARTICIPANTS: SafeRoomParticipant[] = [
  {
    displayName: "Kais",
    role: "HOST",
    isConnected: true,
    joinedAt: "2026-11-21T06:30:00.000Z",
    isSelf: true,
    isEligibleVoter: true,
  },
  {
    displayName: "Nadia",
    role: "MEMBER",
    isConnected: true,
    joinedAt: "2026-11-21T06:31:10.000Z",
    isSelf: false,
    isEligibleVoter: true,
  },
  {
    displayName: "Rafi",
    role: "MEMBER",
    isConnected: true,
    joinedAt: "2026-11-21T06:31:45.000Z",
    isSelf: false,
    isEligibleVoter: true,
  },
  {
    displayName: "Sora",
    role: "MEMBER",
    isConnected: false,
    joinedAt: "2026-11-21T06:32:20.000Z",
    isSelf: false,
    isEligibleVoter: true,
    graceExpiresAt: "2026-11-21T06:36:10.000Z",
  },
];

export function buildContractPreviewFixture(
  stateId: CineMatchScreenStateId,
  noMatchVariant: "DECK_EXHAUSTED" | "ROUND_CANCELLED" | "ROOM_EXPIRED" = "DECK_EXHAUSTED"
): CineMatchContractFixture {
  const baseSnapshot: SafeRoomSnapshot = {
    roomId: "2e4b0a94-6a5c-4c3f-a8c7-8f46d22f0a11",
    code: "CNM482",
    invitePath: "/cinematch?code=CNM482",
    status: "LOBBY",
    stateVersion: 14,
    participantCount: 4,
    connectedParticipantCount: 3,
    maxParticipants: 5,
    minParticipantsToStart: 2,
    reconnectGraceSeconds: 90,
    canStart: true,
    canRetry: false,
    currentRoundId: null,
    latestRoundStatus: null,
    frozenQuorum: null,
    deckFilter: {
      include_adult: false,
      language: "en-US",
      sort_by: "popularity.desc",
      with_genres: "878,12",
      "vote_average.gte": 7.0,
    },
    deckSize: 20,
    expectedDeckSize: 20,
    isDeckShortage: false,
    deck: [SAMPLE_CANDIDATE_ACTIVE, SAMPLE_CANDIDATE_MATCHED],
    matchedMovieId: null,
    matchedCandidate: null,
    currentCandidateIndex: null,
    currentCandidate: null,
    finishState: {
      status: "LOBBY",
      code: "LOBBY_READY",
      reason: null,
      recoverable: true,
      retryAvailable: false,
      retryEndpoint: null,
      matchedMovieId: null,
      message: "Lobby is ready. Host can start once 2–5 guests are joined.",
    },
    expiresAt: "2026-11-22T06:30:00.000Z",
    createdAt: "2026-11-21T06:30:00.000Z",
    participants: BASE_PARTICIPANTS,
  };

  const baseViewer: RoomSessionViewer = {
    participantId: "00000000-0000-4000-8000-000000000001",
    displayName: "Kais",
    role: "HOST",
    isEligibleVoter: true,
    canStart: true,
    canRetry: false,
    userVotes: {},
    nextCandidateIndex: null,
  };

  switch (stateId) {
    case "create":
    case "join":
      return {
        snapshot: baseSnapshot,
        viewer: baseViewer,
        realtimeStatus: "closed",
        errorSample: {
          code: "ROOM_CAPACITY_REACHED",
          status: 409,
          message: "Room CNM482 already has all 5 seats filled.",
        },
        noMatchVariant,
      };
    case "lobby":
      return {
        snapshot: baseSnapshot,
        viewer: baseViewer,
        realtimeStatus: "live",
        errorSample: {
          code: "DECK_EMPTY",
          status: 422,
          message: "No movies matched the selected room filters.",
        },
        noMatchVariant,
      };
    case "swipe":
      return {
        snapshot: {
          ...baseSnapshot,
          status: "ACTIVE",
          canStart: false,
          currentRoundId: "round-01",
          latestRoundStatus: "ACTIVE",
          frozenQuorum: 4,
          currentCandidateIndex: 3,
          currentCandidate: SAMPLE_CANDIDATE_ACTIVE,
          finishState: {
            status: "ACTIVE",
            code: "ROUND_ACTIVE",
            reason: null,
            recoverable: true,
            retryAvailable: false,
            retryEndpoint: null,
            matchedMovieId: null,
            message: "Round 1 is active across 4 frozen participants.",
          },
        },
        viewer: {
          ...baseViewer,
          canStart: false,
          nextCandidateIndex: 3,
        },
        realtimeStatus: "live",
        errorSample: {
          code: "VOTE_CONFLICT",
          status: 409,
          message: "Round advanced while your vote was in flight. Snapshot resynced.",
        },
        noMatchVariant,
      };
    case "vote-wait":
      return {
        snapshot: {
          ...baseSnapshot,
          status: "ACTIVE",
          canStart: false,
          currentRoundId: "round-01",
          latestRoundStatus: "ACTIVE",
          frozenQuorum: 4,
          currentCandidateIndex: 3,
          currentCandidate: SAMPLE_CANDIDATE_ACTIVE,
          finishState: {
            status: "ACTIVE",
            code: "ROUND_ACTIVE",
            reason: null,
            recoverable: true,
            retryAvailable: false,
            retryEndpoint: null,
            matchedMovieId: null,
            message: "Waiting for 1 more frozen participant to vote on Interstellar.",
          },
        },
        viewer: {
          ...baseViewer,
          canStart: false,
          userVotes: { [SAMPLE_CANDIDATE_ACTIVE.candidateId]: "LIKE" },
          nextCandidateIndex: null,
        },
        realtimeStatus: "live",
        errorSample: {
          code: "RATE_LIMITED",
          status: 429,
          message: "Too many resync requests. Retrying automatically.",
          retryAfterSeconds: 4,
        },
        noMatchVariant,
      };
    case "match":
      return {
        snapshot: {
          ...baseSnapshot,
          status: "MATCHED",
          canStart: false,
          currentRoundId: "round-01",
          latestRoundStatus: "COMPLETED",
          frozenQuorum: 4,
          matchedMovieId: SAMPLE_CANDIDATE_MATCHED.movieId,
          matchedCandidate: SAMPLE_CANDIDATE_MATCHED,
          finishState: {
            status: "MATCHED",
            code: "MATCH_FOUND",
            reason: "UNANIMOUS_LIKE",
            recoverable: false,
            retryAvailable: false,
            retryEndpoint: null,
            matchedMovieId: SAMPLE_CANDIDATE_MATCHED.movieId,
            message: "All 4 participants liked Inception!",
          },
        },
        viewer: {
          ...baseViewer,
          canStart: false,
          userVotes: { [SAMPLE_CANDIDATE_MATCHED.candidateId]: "LIKE" },
          nextCandidateIndex: null,
        },
        realtimeStatus: "live",
        errorSample: {
          code: "CLIPBOARD_UNAVAILABLE",
          status: 0,
          message: "Clipboard access was blocked; copy the title manually below.",
        },
        noMatchVariant,
      };
    case "no-match": {
      if (noMatchVariant === "ROUND_CANCELLED") {
        return {
          snapshot: {
            ...baseSnapshot,
            status: "LOBBY",
            canStart: true,
            canRetry: false,
            latestRoundStatus: "CANCELLED",
            finishState: {
              status: "LOBBY",
              code: "ROUND_CANCELLED",
              reason: "PARTICIPANT_GRACE_EXPIRED",
              recoverable: true,
              retryAvailable: false,
              retryEndpoint: null,
              matchedMovieId: null,
              message:
                "Round ended early because Sora did not reconnect within the 90s grace window. Host can adjust filters or start a new round.",
            },
          },
          viewer: { ...baseViewer, canStart: true, canRetry: false },
          realtimeStatus: "live",
          errorSample: {
            code: "ROUND_CANCELLED",
            status: 409,
            message: "Round returned to lobby after grace timeout.",
          },
          noMatchVariant,
        };
      }
      if (noMatchVariant === "ROOM_EXPIRED") {
        return {
          snapshot: {
            ...baseSnapshot,
            status: "EXPIRED",
            canStart: false,
            canRetry: false,
            finishState: {
              status: "EXPIRED",
              code: "ROOM_EXPIRED",
              reason: "INACTIVITY_TTL_EXPIRED",
              recoverable: false,
              retryAvailable: false,
              retryEndpoint: null,
              matchedMovieId: null,
              message:
                "This room expired after 24 hours of inactivity. Create a new room to start another Movie Night.",
            },
          },
          viewer: { ...baseViewer, canStart: false, canRetry: false },
          realtimeStatus: "closed",
          errorSample: {
            code: "ROOM_EXPIRED",
            status: 410,
            message: "Room has expired.",
          },
          noMatchVariant,
        };
      }
      return {
        snapshot: {
          ...baseSnapshot,
          status: "EXHAUSTED",
          canStart: false,
          canRetry: true,
          currentRoundId: "round-01",
          latestRoundStatus: "COMPLETED",
          frozenQuorum: 4,
          finishState: {
            status: "EXHAUSTED",
            code: "DECK_EXHAUSTED",
            reason: "NO_UNANIMOUS_MATCH",
            recoverable: true,
            retryAvailable: true,
            retryEndpoint: "/api/rooms/2e4b0a94-6a5c-4c3f-a8c7-8f46d22f0a11/retry",
            matchedMovieId: null,
            message:
              "All 20 films were reviewed without a unanimous match. Host can spin up a fresh deck or tweak filters.",
          },
        },
        viewer: { ...baseViewer, canStart: false, canRetry: true },
        realtimeStatus: "live",
        errorSample: {
          code: "DECK_EMPTY",
          status: 422,
          message: "No new titles matched those updated filters.",
        },
        noMatchVariant,
      };
    }
    case "error":
      return {
        snapshot: {
          ...baseSnapshot,
          status: "ACTIVE",
          canStart: false,
          currentRoundId: "round-01",
          latestRoundStatus: "ACTIVE",
          frozenQuorum: 4,
          currentCandidateIndex: 3,
          currentCandidate: SAMPLE_CANDIDATE_ACTIVE,
          finishState: {
            status: "ACTIVE",
            code: "ROUND_ACTIVE",
            reason: null,
            recoverable: true,
            retryAvailable: false,
            retryEndpoint: null,
            matchedMovieId: null,
            message: "Round active.",
          },
        },
        viewer: { ...baseViewer, canStart: false, nextCandidateIndex: 3 },
        realtimeStatus: "live",
        errorSample: {
          code: "RATE_LIMITED",
          status: 429,
          message:
            "Too many requests right now. Your vote was not lost—wait a moment and resync the room snapshot.",
          retryAfterSeconds: 5,
        },
        noMatchVariant,
      };
    case "offline":
      return {
        snapshot: {
          ...baseSnapshot,
          status: "ACTIVE",
          canStart: false,
          currentRoundId: "round-01",
          latestRoundStatus: "ACTIVE",
          frozenQuorum: 4,
          currentCandidateIndex: 3,
          currentCandidate: SAMPLE_CANDIDATE_ACTIVE,
          finishState: {
            status: "ACTIVE",
            code: "ROUND_ACTIVE",
            reason: null,
            recoverable: true,
            retryAvailable: false,
            retryEndpoint: null,
            matchedMovieId: null,
            message: "Realtime degraded — polling snapshots every 15s.",
          },
        },
        viewer: { ...baseViewer, canStart: false, nextCandidateIndex: 3 },
        realtimeStatus: "degraded",
        errorSample: {
          code: "NETWORK_ERROR",
          status: 0,
          message: "Connection dropped. Waiting to reconnect before sending votes.",
        },
        noMatchVariant,
      };
  }
}
