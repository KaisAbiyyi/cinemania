# CINE-018 — epoch6 independent native qualification (evidence)

Actor: Claude Code (Sonnet 5.5, `claude-sonnet-5-5`), session `cine-018-pr51-qualification-040873`, separate from the epoch5 implementor and the earlier read-only reviewers.
Claim: https://github.com/KaisAbiyyi/cinemania/issues/20#issuecomment-6995650177 · Scope escalation: https://github.com/KaisAbiyyi/cinemania/issues/20#issuecomment-6996525650

Environment: Windows 11, Node 24.21.0, npm 11.19.0, Next 16.4.5, Docker 28.3.2, Playwright 1.65.0 (Chromium installed this session with owner permission). Hosted staging = owner-designated project `dmrbticnsczhyaiftrar` (PostgreSQL 17), synthetic fixtures only, `ALLOW_DESTRUCTIVE_PG_TESTS=false`, fresh per-invocation `CINE018_STAGING_PROJECT` consent, no reset, no schema/grant/key/config change. Staging inventory before and after every batch: rooms/participants/votes/events/guest sessions/auth users/realtime messages = 0; 3 `cinematch_*` realtime policies; no other realtime policies.

## Source heads

| Head | Tree | What |
|---|---|---|
| `281a3984dc5bf64b320b5f69bb381c51bdbf75eb` | `9bccda6d…` | PR #51 head at reclaim (unchanged product + harness) |
| `6797f80b94fbd3308ac0501d6660179ba902615e` | `bdc0156d…` | + harness-only JWT-renewal fix |
| `cfc9187a5db9aed5bbba78b8f5acef19eeb703f1` | `c0f0ecdf419836935b8e1720a2ca6c9ad799f331` | + read-only failure diagnostics (FINAL) |

`git diff 281a3984..cfc9187a --stat`: 1 file, `tests/local-supabase/two-instance-qualification.cjs` (+37/−1). **No product source, migration, policy, grant, TTL, timeout, TLS or threshold change.**

## Root cause of the preserved intermittent failure (verified, not hypothesised)

Hosted Realtime **closes a private channel when its 60 s room JWT expires** (observed status `CLOSED` at t=59.7 s; see `diag-jwt-expiry-no-renewal.log`). Hints sent at 66/75/79/83 s were never delivered and a late `setAuth` did not revive the channel. With the product client's 30 s renewal cadence hints at 10.8/41/71.3/101.6 s all arrived (`diag-jwt-renewal-30s-cadence.log`) and 184/184 continuous hints arrived across three renewals with no close (`diag-jwt-renewal-race-184-of-184.log`). The harness's test WS clients (`connectRoomWs`) minted one token and never renewed it, so a run whose normal-traffic phase exceeded ~60 s after connect (15–20 s Turbopack compiles) silently lost later hints → `Timed out waiting for WS version N` (epoch5 "version7" and my 281a3984 attempt 5 "version6"). Product code was **not** at fault (it renews every 30 s). Isolated hosted latency is healthy (PG RTT p50 89 ms; broadcast POST p50 135 ms; 0/15 over the 1500 ms publisher timeout; `diag-hosted-latency-isolated.log`), ruling out WAN slowness for that failure mode.

Fix: test WS clients renew every 30 s exactly like `src/lib/realtime/roomRealtime.ts`; renewal is refreshed immediately **before** and **paused during** the no-HTTP COMMIT→kill→recovery window and during the manual-renewal latency section.

## Check matrix (all cwd = worktree, PowerShell/cmd on Windows)

| Check | Head | Result | Evidence |
|---|---|---|---|
| `npm ci` | 281a3984 | exit 0 | (console) |
| lint / typecheck / `npm test` | 281a3984 | 0 errors,26 warnings / pass / 403 passed,7 skipped | `native-regression-281a3984-lint-typecheck-test.log` |
| lint / typecheck / `npm test` / build / bundle-secrets / 27 Chromium E2E | **cfc9187a** | all exit 0 | `cfc9187a-*.log` |
| Hosted private WS/JWT/RLS (10 controls) | 281a3984 | PASS | `281a3984-hosted-rls-ws.log` |
| Hosted private WS/JWT/RLS | cfc9187a | attempt1 **FAIL** (8 s subscribe TIMEOUT, workstation-side stall; server logs show no error) then 3/3 PASS reruns | `cfc9187a-hosted-rls-ws.*` |
| Hostile-JWT membership RPC (8 controls, HTTPS PostgREST) | 281a3984 | PASS | `281a3984-hostile-jwt-rpc.log` |
| Hostile-JWT membership RPC | cfc9187a | attempt1 **FAIL** (10 s HTTP abort; cleanup PASS) then 3/3 PASS reruns | `cfc9187a-hostile-jwt-rpc.*` |
| Canonical schema/grants parity (9 categories) vs exact-head migrations in disposable LOCAL DB | 281a3984 and cfc9187a | PASS both | `*-hosted-schema-consistency.log` |
| Hosted full two-instance (2 Next, 2 worker, 2 Chromium contexts, groups 2–5, privacy, reorder/dup/stale, reconnect/gap, COMMIT→SIGKILL→autonomous WS receipt+PG ack with no app HTTP, dispatcher restart, 30 latency samples) | 281a3984 | 2 PASS, 1 FAIL (JWT-expiry cause above); 2 pre-runs ENV-FAIL (GNU tar from Git Bash; Playwright browser missing) preserved | `281a3984-two-instance-*` |
| same | 6797f80b | 3 PASS, **1 FAIL** `Timed out waiting for WS version 12; saw [8,9,10,11]` in a group phase — **cause NOT VERIFIED** (no failure diagnostics existed yet; renewal-race hypothesis refuted by the 184/184 diagnostic; no instance dispatch-failure line in log) | `6797f80b-two-instance-run1..4-*` |
| same | **cfc9187a (final)** | **10/10 PASS**, 0 owned rooms remaining each run | `cfc9187a-two-instance-run1..10-PASS.log` |
| CI | 6797f80b / cfc9187a | 5/5 + Vercel success: runs 44434719261 / 44440831965; synthetic merge `6a060b8d…` tree == `c0f0ecdf…` (verified) | gh |

Latency at cfc9187a (30 sequential PATCH→guest private WS, nearest-rank, cold sample retained, per run): p50 1538–1658 ms (median 1590), p95 1619–2966 ms (median 2011), p99 2815–3702 ms (max 3702); includes workstation↔Asia hosted PG round trips; measurement only, not an SLO.

## Honest limits

- 13/14 hosted full runs passed after the harness fix (3/4 at 6797f80b, 10/10 at cfc9187a); the single post-fix failure (6797f80b run 4) is **unexplained**. Whether a one-off missed hint is Realtime best-effort delivery, client network stall or other is NOT VERIFIED. Two further isolated 8–10 s stalls (RLS/RPC attempt1 at 02:38–02:39Z) coincide with 4–15 s client-side gaps and no Supabase server error; transient client-network latency is the supported explanation, not proven.
- Hints are best-effort by design; the product heals via 15 s snapshot polling and version-gap reconciliation. The product client does **not** resubscribe if a channel goes `CLOSED` (e.g. a missed 30 s renewal in a throttled background tab); polling still converges state. Recorded as a CINE-019 follow-up, not a CINE-018 blocker.
- Provider-fault outbox suite uses real hosted PG with simulated publisher faults (not a real provider outage). No production supervisor deployed. Browser contexts run the real subscriber module, not finished F3 UI. Security advisor on staging: 3 INFO (server-only RLS tables) + 1 WARN (intentional authenticated SECURITY DEFINER membership helper, with 8 hostile controls). Private-trace/credential-rotation question and backup scope are unchanged from the epoch5 receipt (owner statements; not independently audited).
- Test artifacts pass an actual-value scan (literal/URL/base64/base64url/last-24, 4 secret values, 51 files): 0 matches. Evidence files normalised to UTF-8/LF; raw content otherwise unmodified.
