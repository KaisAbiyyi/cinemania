# CINE-019 reconnect, concurrent actions and idempotency

Scope: client state and concurrency only (`src/lib/realtime/**`). The publisher, its authorization policy
(migration 005), rate limiting (CINE-021) and the finish-state / disconnect policy (CINE-020) are unchanged.

## Contract

- A Realtime broadcast is only an invalidation hint. State comes from an authenticated HTTP snapshot, gated by a
  monotonic `stateVersion`: a duplicate, reordered or replayed hint, or a response that arrives late, can never
  deliver a version twice or move the view backwards (`roomReconciler.ts`).
- A successful vote or start response (`room` + `viewer`, the full snapshot shape) is offered to the same gate, so
  the later hint for that version is a no-op (`accept`). Filter responses have a reduced viewer and are not accepted;
  a resync follows instead.
- The server remains the only authority. Votes are serialized by the room row lock, immutable, and idempotent per
  `(round, participant, operationId)`, which is scoped to one room and one actor. The client never decides a match.

## Client recovery (`roomRealtime.ts`)

| Condition | Behaviour |
| --- | --- |
| `CLOSED`, `CHANNEL_ERROR`, `TIMED_OUT` after the first subscription | Renew the capability, replace the channel with a new one (a late `setAuth` does not revive a closed private channel, L-005), force a snapshot read after `SUBSCRIBED`. Jittered exponential backoff 0.5 s..10 s, so a 90 s outage contains many attempts. `reconnecting`, then `degraded` after 3 failed attempts. |
| JWT lifetime (server TTL 60 s, unchanged) | **Make-before-break rotation** at about half the token lifetime (`exp - iat`, measured from the local fetch time, so a skewed client clock cannot cause a rotation storm; never more often than every 5 s): fetch a new capability, join a second client/channel with it, then retire the old one. A renewed token is never pushed to a joined channel, because the local Realtime service closes such a channel early (probe: renewal at 30 s closed it at 50 s). A failed rotation keeps the old channel, retries with backoff, and reports `degraded` once the ACTIVE channel's own token deadline passes. `UNAUTHORIZED` (401/403/404/410) stops permanently instead of hammering. |
| Fresh socket per subscription | Every join (initial, rotation, recovery) uses a brand-new Supabase client and socket and the old one is disposed (channel, socket and auth client). Reusing one socket replayed buffered same-topic join/leave pushes after an outage and a stale leave closed the newest channel (tight live/reconnecting flap, found by the real-service qualification). The unused auth client is not initialised and is disposed, so no `visibilitychange` listener leaks. |
| Background throttling / frozen tab | One heartbeat checks wall-clock deadlines. A gap above 15 s, `visibilitychange`, `focus`, `pageshow` or `online` forces: token check, channel health check, a snapshot read, and cuts any backoff sleep short. |
| Dropped final broadcast | Snapshot poll every 15 s while the tab is running. |
| Hint ahead of the snapshot | Bounded retry (5), then left to the poll. |
| Snapshot failure | Retried with backoff instead of waiting for the next poll; 401/403/404/410 are permanent. |
| Stale channel callbacks | Ignored: a disposed slot is marked `dead`, so late `SUBSCRIBED`/`CLOSED`/hints from it do nothing. `close()` and a permanent failure dispose every slot, including a join still in flight. |
| Token endpoint budget | The capability endpoint may be rate limited per guest (CINE-021 proposes 12/min). Recovery reuses a capability that is still in the first half of its life instead of fetching one per join attempt (at most about one fetch per half-life even during a long outage), and a `Retry-After` (capped at 60 s) on a refused token request delays the next attempt of both rotation and recovery. |
| Wake-up bursts | `focus`, `visibilitychange`, `pageshow` and `online` are coalesced to one resync per second. |

`startRoomRealtime` keeps its signature and returns a callable close handle that also exposes `resync()`,
`accept(snapshot)` and `status()`. `onStatus` and typed `RoomRealtimeError` (`code`, `status`, `permanent`) are new.

## Action layer (`roomActions.ts`)

Identical in-flight actions share one request; a different vote for a candidate already in flight is refused
locally (votes are immutable). A vote carries a stable operation id (`vote:<round>:<candidate>`, in header and body),
so a retry after a lost response is a server-side replay. Only idempotent actions are retried automatically (votes,
filter replacement; network, 500/502/503/504, unreadable 2xx; never after a long `Retry-After`), always with the same
payload. `start` and `leave` are never retried automatically: after an ambiguous failure the layer resyncs and returns
`transient`, so a committed start is never repeated and a departed participant is never re-asked. A 409,
`ROUND_NOT_FOUND` or `CANDIDATE_NOT_FOUND` means a stale view: the layer requests an authoritative snapshot and returns
`stale: true`. Vote and start responses are offered to the version gate; a filter response is not (its viewer lacks
the vote summary), a resync follows instead. Filter edits are serialized in host order. 400/401/403/429 are returned
without retry or resync.

## Scope boundaries and honest limits

- The 90 s reconnect grace and any cancellation or host-loss policy belong to CINE-020. This change never cancels a
  round and never changes the frozen quorum; it provides the reconnect machinery that policy will rely on.
- Reload (cookie rejoin) already bumps neither version nor participant count; this is now covered by tests.
- Browser UI integration (CINE-023/024) is not part of this task; no UI consumer of the new status exists yet.
