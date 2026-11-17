# CINE-018 review response — epoch5

Source remains `281a3984dc5bf64b320b5f69bb381c51bdbf75eb`, tree `9bccda6d749d79bb99ba27030c519d42b49a503a`; base is remote main `80c1464aca698712c7f283ff2e97d70fca25acbf`. Local `main` is an older checkout; comparisons use the explicit remote-main SHA. No source, schema, grant, policy, key, timeout or TLS configuration was changed in this continuation. This evidence branch is separate from PR #51's feature HEAD.

Review: https://github.com/KaisAbiyyi/cinemania/pull/51#pullrequestreview-5942390155
Claim: https://github.com/KaisAbiyyi/cinemania/issues/20#issuecomment-6954240655
Session: cine018-reviewfix-20261117 epoch5; single Codex, requested GPT-6.1 Sol High profile; runtime build not exposed. No delegation, approval, merge or production deployment.

## Diagnostic boundaries and preserved failures

`transport-diag.cjs` made six sequential read-only connections on Windows Node24.21.0 and six on a controlled local Docker Linux Node24.22.3 runner. All12 passed DNS/TCP/TLS1.3/SASL/ReadyForQuery/SELECT with encrypted and authorized sockets. Connection timeout remains10000ms. Linux image `node@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54` (node24-bookworm-slim). Source mounted read-only; no new hosted runner/account/project. Windows now resolved NAT64 IPv6 plus IPv4; Linux used IPv4. This does not establish why earlier connections timed out. No DNS or network configuration was modified by this agent.

A later Linux read-only confirmation also passed6/6 with an exact complete Docker invocation recorded in `qualification-manifest.json` and stdout/exit0 in `linux-transport-confirm.log`. Total read-only transport probes in epoch5:18/18 (Windows6, Linux initial6 plus confirmation6). No app tests are attributed to Linux.

The first subsequent frozen-head hosted attempt exited1 waiting for version7, saw3,4,5,6; its full log and successful ownership-scoped cleanup are retained. The earlier joinHTTP500 and epoch4 startup timeout remain genuine historical failures with root cause NOT VERIFIED. Do not claim a product repair or silently replace these failures with later PASS.

The next run used observation-only `observer-preload.cjs` and exited0 across the full suite. No observer callback metadata was emitted, so this run does **not** establish the hypothesized JWT-expiry cause. `outbox-observations.json` contains read-only database polling during this diagnostic run only, with no app HTTP. It is not the final uninstrumented acceptance run. No TTL, test deadline or publisher timeout was extended.

## Security advisor disposition

Live advisor still reports3 INFO findings for RLS-enabled server-only tables and1 WARN for authenticated SECURITY DEFINER execution. `security-review.json` preserves these findings and effective grants. `guest_capability_sessions`, `room_events`, and `votes` deny SELECT to anon/authenticated and retain RLS; adding public policies would weaken the approved design.

ADR-003's non-enumerating membership helper intentionally requires authenticated EXECUTE for SELECT RLS on rooms/rounds/candidates. A blanket revoke breaks these policies; switching to SECURITY INVOKER loses the non-enumerating privileged lookup. UI code does not need a direct RPC call, but EXECUTE is needed by the existing policy contract. The function has fixed public,pg_temp search_path, obtains identity solely from verified JWT sub, accepts only a room UUID, and returns a boolean. This assessment preserves the linter warning; it is not a claim that the advisor became clean or that all possible attacks were exhaustively excluded.

`helper-rpc-qualification.cjs` executed8 real HTTPS PostgREST controls on staging: own membership200true; cross-room200false; other member200false; outsider with forged user_metadata identity200false; anonymous401; forged signature401; expiredJWT401; extra target_user_id404. Exact owned fixture provenance and cleanup are saved; all fixtures removed. No grants/schema were changed.

Owner answered that the private trace/screenshot was never shared outside this conversation/account. This is an owner exposure assessment, not an independently audited access history. No rotation was authorized or performed. Actual-value artifact scanning includes full literal/URL/base64/base64url and last24-character representations; zero public matches are required before publication. Private original traces and credentials remain outside Git.

## Backup and release boundaries

Epoch4's private backups and locally verified application/public/history restore remain the baseline; see the previous receipt. They do not demonstrate full managed Auth/config/platform disaster recovery. This continuation performs no DDL or destructive reset, only owned synthetic fixtures and cleanup. Production worker packaging remains verified at the same source HEAD by the existing clean omit-dev install/boot receipt. Supervision/restart/liveness are documented requirements, not a deployed supervisor. Keep staging intact for acceptance; future release cleansing requires a separate owner gate.

## Reproduction and method

All commands run from `D:/projects/cinemania`, with invocation `CINE018_STAGING_PROJECT=dmrbticnsczhyaiftrar` and `ALLOW_DESTRUCTIVE_PG_TESTS=false`; credential files cannot grant consent. Node24.21.0/npm11.19.0/Next16.4.5 on Windows; hosted PostgreSQL17.11.0.018. Transport diagnostics use the additional Linux version above.

Final hosted command: `node tests/local-supabase/two-instance-qualification.cjs --app-commit 281a3984dc5bf64b320b5f69bb381c51bdbf75eb --hosted-staging`. Two independently archived source+node_modules directories, Next ports3101/3102, two autonomous worker processes, two Chromium contexts running the real subscriber module; group sizes2,3,4,5. This is client-module browser evidence, not finished F3 room UI acceptance.

Crash proof stops browser polling and both workers, commits an actual authority mutation in a child, kills the child before publish, then starts workers and waits for private WS receipt plus durable PG acknowledgement before resuming any app HTTP. Repeated after dispatcher restart. Replay uses the authenticated API; stale/duplicate/future hints exercise the reconciler. The final receipt must identify the separate uninstrumented result.

Latency uses30 real mutations from instance1 through hosted PG and hosted private WS to a guest authenticated via instance2. Measure client monotonic time immediately before PATCH to WS receipt; refresh60s guestJWT outside measured operations and after the no-HTTP recovery window. Nearest-rank p50/p95/p99 from the sorted30 values. Cold first mutation included, no samples trimmed. These are sequential workstation-to-staging measurements, not a load-test SLA or provider-only latency.

Existing unchanged-HEAD regression, local Docker, hosted security/catalog/fault and CI evidence: https://github.com/KaisAbiyyi/cinemania/issues/20#issuecomment-6950947497
Immutable epoch4 artifacts: https://github.com/KaisAbiyyi/cinemania/tree/9ab2c4645b0cd8acfbc29cd25760d5065e8c3398/docs/evidence/CINE-018/281a3984dc5bf64b320b5f69bb381c51bdbf75eb
Those results remain attributed to their original commands/environments; none is falsely described as rerun by the independent reviewer. Real hosted PG poison/retry/fairness tests use simulated publisher faults, whereas the two-instance crash/restart test uses actual hosted transport.

## Final uninstrumented result

`hosted-two-instance.attempt-1794934328339.log`: started2026-11-17T16:52:08.339Z, ended17:00:35.405Z, exit0, clean feature checkout. Every declared full-suite assertion passed, including two independent Next/worker processes, both real browser contexts, groups2..5, unanimous MATCHED/vote privacy, actual COMMIT/process kill followed by autonomous worker recovery with WS receipt/durable acknowledgement before any HTTP, dispatcher restart, concurrency and reconnect/replay/reorder/dedup. Exact five owned rooms were removed, remainingOwnedRooms0.30 raw latency samples: p50=1818.36ms, p95=1994.40ms, p99=3161.02ms, min1738.67ms/max3161.02ms,2 token renewals outside measured operations. This is a new PASS at the unchanged source HEAD, not a rewrite of earlier failures. Prior startup/join/normal-hint intermittency remains a disclosed reliability observation with cause NOT VERIFIED.

Independent final review and owner acceptance remain mandatory. Do not mark Done, merge, deploy, or promote CINE-019/021 on implementor evidence alone.
