# CINE-022 · CineMatch Visual Direction & Interaction Contract

**Task:** `[CINE-022] Gemini-owned visual direction and interaction contract` ([Issue #24](https://github.com/KaisAbiyyi/cinemania/issues/24))  
**Scope:** F3 Visual Identity, Design System, Component Primitives, Responsive Layout Geometry, Motion/Reduced-Motion, Keyboard/ARIA Accessibility, and 9-State Backend Contract Mapping (`create` / `join` / `lobby` / `swipe` / `vote-wait` / `match` / `no-match` / `error` / `offline`).  
**Non-negotiable boundary:** Aesthetics and UX contract only — zero modifications to backend game rules, quorum invariants, API routes, or database schema.

---

## 1. Visual Direction & Design Rationale

### Identity: **Daylight Matinee (Light) & Velvet Screening Room (Dark)**
CineMatch lives inside the canonical Cinemania Next.js 16 App Router shell (`src/components/layout/AppShell.tsx:35-59`) alongside `Geist` and `Geist Mono` (`src/app/layout.tsx:1-31`). Rather than introducing an isolated dark-only micro-site that clashes with Cinemania's discovery theme toggle, CineMatch defines paired **Daylight Matinee** (`:root`) and **Velvet Screening Room** (`.dark`) semantic tokens in `src/app/globals.css`:

- **Why dual-theme native tokens (`--cm-*`):** Users frequently switch between Cinemania's Browse/Discover views and CineMatch Movie Night rooms via `ThemeToggle`. Defining explicit `--cm-*` hex-backed surfaces and action fills in `src/app/globals.css` guarantees deterministic WCAG 2.1 AA contrast (`>= 4.5:1` for normal text, `>= 3.0:1` for interactive borders/controls) in both themes.
- **Typography & Tabular Precision:**
  - `Geist Sans` for film titles, synopsis copy, roster names, and action labels.
  - `Geist Mono` with `tabular-nums` strictly reserved for **6-character Room Codes** (`CNM482`), **deck progress counters** (`Card 04 / 20`), **quorum tallies** (`3 / 4 votes`), **90s grace timers**, and **machine error codes** (`RATE_LIMITED`, `DECK_EMPTY`).
- **Tactile Cinema Hierarchy:**
  - High-contrast 2:3 / 16:9 poster stage with a guaranteed bottom dark gradient scrim (`from-black/90 via-black/35 to-transparent`) so white movie titles, release years, and TMDB scores never lose legibility over bright posters.
  - Distinct color-coded decision grammar paired with explicit icons and labels (never color-only):
    - **LIKE:** Emerald Velvet (`#065f46` + `#ffffff` text) + Heart/Check icon
    - **SKIP:** Crimson Ticket (`#be123c` + `#ffffff` text) + X icon
    - **UNANIMOUS MATCH:** Marquee Amber (`#fef3c7`/`#78350f` in light, `#451a03`/`#fde68a` in dark) + Sparkles icon
    - **PRIMARY FLOW (Create / Start / Retry):** Deep Violet (`#5b21b6` light / `#6d28d9` dark + `#ffffff` text)

---

## 2. Responsive Breakpoints & Overflow-Free Geometry

Verified at **375px** (mobile), **768px** (tablet), and **1440px** (desktop) on `/cinematch`:

| Breakpoint | Layout Structure | Touch & Spacing Rules |
|---|---|---|
| **375px** (Mobile) | Single-column stack (`grid-cols-1`); state tabs wrap cleanly (`flex-wrap`); Like/Skip bar is a symmetric 2-column grid (`grid-cols-2 gap-3`) directly below the poster card | All interactive buttons `min-h-[44px]`; primary CTAs & Like/Skip `min-h-[48px]`; `min-w-0` + `overflow-x-hidden` prevent horizontal scroll (`scrollWidth <= clientWidth`) |
| **768px** (Tablet) | Single-column centered stage (`max-w-6xl`) with 2-column compact participant roster (`sm:grid-cols-2`) and 16:9 poster stage | Roster cards remain readable without truncating Host/Guest/Connected status badges |
| **1440px** (Desktop) | 12-column split (`lg:col-span-7` Interactive Stage + `lg:col-span-5` Contract/Telemetry Sidebar) inside `AppShell` | Sidebar and MainContent preserve independent scroll; focus outlines remain visible with `outline-offset-2` |

---

## 3. Motion & `prefers-reduced-motion` Contract

Defined in `src/app/globals.css`:
- `.cm-motion-surface`: `240ms cubic-bezier(0.22, 1, 0.36, 1)` on `transform`, `opacity`, `border-color`, `box-shadow` for card swipe drag/tilt (`clamp(-6deg, dx * 0.04, 6deg)`).
- `.cm-match-glow`: `2.4s ease-in-out infinite` amber marquee halo on the `MATCHED` winner card.
- **Reduced Motion Binding Rule:** Under `@media (prefers-reduced-motion: reduce)` (and `.cm-reduced-motion` manual preview class), `.cm-motion-surface` collapses to `transition-duration: 0.01ms !important; transform: none !important;` and `.cm-match-glow` sets `animation: none !important;`. Pointer drag displacement is also suppressed when reduced motion is active.

---

## 4. Accessibility, Keyboard & Contrast Contract

- **WCAG 2.1 AA Contrast Matrix:** Implemented and continuously asserted in `src/components/cinematch/designTokens.ts` and `tests/unit/cinematch-design-tokens.test.ts`:
  - All text-on-surface and label-on-fill tokens meet `>= 4.5:1` in both Light and Dark themes.
  - Interactive input/card border tokens meet `>= 3.0:1` (`WCAG 1.4.11`).
- **Keyboard Walkthrough:**
  1. State selector tabs (`role="tablist"`) follow the WAI-ARIA Tabs Pattern with **roving `tabIndex`** (`0` on active tab, `-1` on inactive tabs) and **`ArrowLeft` / `ArrowRight` / `Home` / `End`** focus + activation wrapping cleanly across all 9 states.
  2. `Tab` exits the active tab directly into theme/role/motion controls -> active stage inputs/controls -> recovery/secondary actions.
  3. In `swipe` state, focusing the active voting region enables **`ArrowLeft` / `S`** (Skip) and **`ArrowRight` / `L`** (Like) alongside Tab-reachable `Skip Film` and `Like Film` buttons.
  4. All custom interactive controls expose `focus-visible:outline-2 focus-visible:outline-offset-2`, and clipboard copy actions (`RoomCodeChip`, `Copy Match Title`) fail closed with a scoped `[role="alert"]` manual copy fallback instead of false success when `navigator.clipboard.writeText` is unavailable or denied.
- **ARIA & Next.js 16 Isolation (L-057):**
  - Passive connection/vote confirmations use `role="status"` and `aria-live="polite"`.
  - Actionable failures use a scoped `[data-testid="cm-scoped-alert"][role="alert"]` card, kept strictly separate from Next.js 16's `#__next-route-announcer__`.

---

## 5. Complete 9-State Mapping to Authoritative Backend Contracts

Source contracts verified in:
- `SafeRoomSnapshot`, `SafeRoomParticipant`, `RoomSessionViewer`: `src/lib/server/room/roomSnapshot.ts:82-154`
- `RoomFinishState`: `src/lib/server/room/finishPolicy.ts:34-49`
- `SafeDeckCandidate`, `CanonicalRoomDeckFilter`: `src/lib/schemas/roomDeck.ts:65-228`
- `RealtimeStatus`, `RoomRealtimeError`: `src/lib/realtime/roomRealtime.ts:9-36`
- `createRoomActions`, `RoomActionResult`: `src/lib/realtime/roomActions.ts:5-68`
- `VALID_TRANSITIONS`, `validateStartLobbyRoundPrerequisites`: `src/lib/server/room/stateMachine.ts:81-151`

| # | State ID | Authoritative Trigger / Mapping | Primary UI & Actions | Prohibited Patterns |
|---|---|---|---|---|
| 1 | `create` | Pre-room entry -> `POST /api/rooms` | Host display name (`1–32` chars), filter summary (`include_adult: false`), `Create Screening Room` CTA (`>= 48px`), link to Join | Never expose capability token in URL/DOM; no account gate |
| 2 | `join` | Pre-room entry (`/cinematch?code=...`) -> `POST /api/rooms/join` | Monospace 6-char code input (strips query secrets), display name, distinct inline `404/409/410` error alert, `Join Screening Room` CTA | Never treat error alert as loading spinner; never preserve URL secrets |
| 3 | `lobby` | `snapshot.status === "LOBBY"` & `finishState.code === "LOBBY_READY"` | `RoomCodeChip` (Copy Code/Link), `ParticipantRosterList` (`2–5` slots, Host/Guest, Connected/Grace), Host-editable vs Guest-read-only filters, Host-only `Start Movie Night` (`canStart`) | Never show active Start button to guests; never expose peer `participantId` |
| 4 | `swipe` | `snapshot.status === "ACTIVE"` & `viewer.nextCandidateIndex !== null` | Progress (`Card X / deckSize`), `CandidatePosterStage`, drag + `Skip Film` / `Like Film` (`>= 48px`) + `ArrowLeft`/`ArrowRight` shortcuts, single-flight `voteOperationId` lock | **Never show optimistic `MATCHED`** before server ack; never double-submit votes |
| 5 | `vote-wait` | `snapshot.status === "ACTIVE"` & current candidate in `viewer.userVotes` | Immutable vote badge (`You voted LIKE/SKIP`), disabled action bar, frozen quorum progress (`3 / 4 votes`), 90s reconnect grace indicator | Never allow changing/re-submitting a recorded vote; never shrink frozen quorum |
| 6 | `match` | `snapshot.status === "MATCHED"` & `finishState.code === "MATCH_FOUND"` | `IT'S A MATCH!` marquee header (`cm-match-glow` respects reduced motion), `matchedCandidate` poster/details, TMDB attribution, sanitized Copy Match Title | **Never invent streaming availability**; never embed private room tokens in share text |
| 7 | `no-match` | `finishState.code` in `DECK_EXHAUSTED`, `ROUND_CANCELLED`, `ROOM_EXPIRED` | Distinct outcome copy per finish code; Host `Start Fresh 20-Film Round` (`retryAvailable`) or `Return to Lobby`; `Create New Room` when expired | Never display `DECK_EXHAUSTED` as a 500 crash; never show Retry when `retryAvailable === false` |
| 8 | `error` | `RoomActionFailure` (`ok: false`) or HTTP `4xx/5xx` API response | Scoped `[role="alert"]` (`CineMatchAlertCard`) with machine error code, plain-language recovery message, optional `Retry-After` countdown, `Resync Room State` CTA | Never leak stack traces/secrets; never leave user trapped on an infinite spinner |
| 9 | `offline` | `RealtimeStatus` in `["reconnecting", "degraded", "closed"]` or `navigator.onLine === false` | Non-blocking `ConnectionStatusBanner` (`role="status"`), preserved current card/lobby context, paused vote/start actions, manual `Reconnect & Resync` CTA | Never wipe active card to blank screen; never claim `Live` while degraded/offline |

---

## 6. Verification & Interactive Contract Studio

- **Interactive Contract Route:** `src/app/cinematch/page.tsx` -> `src/components/cinematch/CineMatchContractStudio.tsx`
- **Unit Verification:** `tests/unit/cinematch-design-tokens.test.ts` (contrast ratios across light/dark palettes, 9-state contract completeness, zero secret leakage in fixtures)
- **Playwright E2E Verification:** `tests/e2e/cinematch-design-contract.spec.ts` (375/768/1440px responsive overflow & bounding-box audit, `>= 44px` touch target audit, `prefers-reduced-motion: reduce` CSS verification, keyboard tab-order & `ArrowLeft`/`ArrowRight` walkthrough, light/dark rendering, and settled screenshots under `docs/artifacts/CINE-022/`).
