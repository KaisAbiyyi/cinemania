# CINE-018 staging evidence

Qualified application source: 281a3984dc5bf64b320b5f69bb381c51bdbf75eb; tree 9bccda6d749d79bb99ba27030c519d42b49a503a. Artifact publication is on a separate evidence branch; it does not change PR #51 HEAD.

Logs record command/cwd/UTC/environment/exit. Only clean exact-source logs qualify final HEAD. Candidate and working-tree failure files are historical FAIL evidence, not final qualification. A first catalog comparison reported auth.jwt() vs jwt() deparser search_path differences; its first full stdout was overwritten before logging became non-overwriting, and only the observed excerpt/diagnosis remains in the receipt. Subsequent parser/sequence failures are retained here.

Backup contents and credentials are PRIVATE and intentionally excluded. Baseline JSON carries hashes and bounded restore evidence; no claim of full platform/ACL/role restoration. JWT/server values and any matching encodings are redacted before publication.

Latency method:30 sequential PATCH mutations to Next instance1, measured with a single monotonic controller clock until guest private WS callback (via hosted PG/Realtime); nearest-rank percentiles; raw samples retained. Raw observer obtains signed renewal during the latency section, outside each measured mutation and strictly after autonomous no-HTTP recovery. This is a workstation/dev-server/network cohort, not a production SLO or100-room load test.

Real browser probes execute the shipped realtime module in two Chromium contexts; no finished room UI integration is inferred. Crash injection kills a real authority-transaction child after COMMIT, before publication; workers must produce WS receipt+durable acknowledgement before any subsequent application HTTP. PG fault injection uses simulated provider failures on real hosted PG; separate WS logs prove actual provider transport.

Owner acceptance, independent review, merge and production deployment remain separate gates. See Issue #20 and PR #51 for exact PASS/FAIL/BLOCKED matrix and preserved incidents.

## Overall verdict: BLOCKED

Final hosted two-instance suite exited1 on PostgreSQL connection timeout before fixture creation. Full final-head hosted browser/group/crash/restart/latency gates are NOT RUN/BLOCKED, not PASS. The read-only connectivity diagnostic retained both successful strict client-TLS sessions and connection timeouts; the server backend pg_stat_ssl field refers to the pooler backend session and is recorded separately from the verified client socket. Do not substitute local latency or prior candidate component observations for hosted acceptance. Final source remains draft/Blocked/Now pending stable qualification transport, independent review and owner acceptance.
