# CINE-019 reconnect, concurrent actions and idempotency

Scope: client state and concurrency only (`src/lib/realtime/**`). The publisher, its authorization policy
(migration 005), rate limiting (CINE-021) and the finish-state / disconnect policy (CINE-020) are unchanged.

## Contract

- A Realtime broadcast is only an invalidation hint. State comes from an authenticated HTTP snapshot, gated by a
  monotonic `stateVersion`: a duplicate, reordered or replayed hint, or a response that arrives late, can never
  deliver a version twice or move the view backwards (`roomReconciler.ts`).
- A successful mutation response (`room` + `viewer`) is offered to the same gate, so the later hint for that
  version is a no-op (`accept`).
- The server remains the only authority. Votes are serialized by the room row lock, immutable, and idempotent per
  `(round, participant, operationId)`, which is scoped to one room and one actor. The client never decides a match.

## Client recovery (`roomRealtime.ts`)

| Condition | Behaviour |
| --- | --- |
| `CLOSED`, `CHANNEL_ERROR`, `TIMED_OUT` after the first subscription | Renew the capability, replace the channel with a new one (a late `setAuth` does not revive a closed private channel, L-005), force a snapshot read after `SUBSCRIBED`. Jittered exponential backoff 0.5 s..10 s, so a 90 s outage contains many attempts. `reconnecting`, then `degraded` after 3 failed attempts. |
| JWT lifetime (server TTL 60 s, unchanged) | Renewal at about half the lifetime from the token's own `iat`/`exp`, using wall-clock deadlines. Failed renewals back off; `degraded` once the token has expired; `UNAUTHORIZED` (401/403/404/410) stops permanently instead of hammering. |
| Background throttling / frozen tab | One heartbeat checks wall-clock deadlines. A gap above 15 s, `visibilitychange`, `focus`, `pageshow` or `online` forces: token check, channel health check, a snapshot read, and cuts any backoff sleep short. |
| Dropped final broadcast | Snapshot poll every 15 s while the tab is running. |
| Hint ahead of the snapshot | Bounded retry (5), then left to the poll. |
| Snapshot failure | Retried with backoff instead of waiting for the next poll; 401/403/404/410 are permanent. |
| Stale channel callbacks | Ignored through a channel generation counter. |

`startRoomRealtime` keeps its signature and returns a callable close handle that also exposes `resync()`,
`accept(snapshot)` and `status()`. `onStatus` and typed `RoomRealtimeError` (`code`, `status`, `permanent`) are new.

## Action layer (`roomActions.ts`)

Identical in-flight actions share one request; a different vote for a candidate already in flight is refused
locally (votes are immutable). A vote carries a stable operation id (`vote:<round>:<candidate>`, in header and body),
so a retry after a lost response is a server-side replay. Retries (network, 500/502/503/504) reuse that id. A
409, `ROUND_NOT_FOUND` or `CANDIDATE_NOT_FOUND` means a stale view: the layer requests an authoritative snapshot and
returns `stale: true`. Filter edits are serialized in host order. 400/401/403/429 are returned without retry or resync.

## Scope boundaries and honest limits

- The 90 s reconnect grace and any cancellation or host-loss policy belong to CINE-020. This change never cancels a
  round and never changes the frozen quorum; it provides the reconnect machinery that policy will rely on.
- Reload (cookie rejoin) already bumps neither version nor participant count; this is now covered by tests.
- Browser UI integration (CINE-023/024) is not part of this task; no UI consumer of the new status exists yet.
