# CINE-018 autonomous dispatch plan

Owner-directed single-agent execution; no delegation, merge, deployment or hosted writes.
Baseline: PR #51 d82fa162; merged main 80c1464a integrated at 1b0a9bb5.

## Design

Run a dedicated supervised Node worker separately from Next.js. A periodic loop scans
pending non-poison room IDs in UUID keyset order, with a bounded page and no overlapping
sweeps. It invokes the existing three-event ordered dispatcher under the same PostgreSQL
transaction advisory lock as the HTTP fast path. Fixed bounded polling controls retry rate;
retry and permanent-rejection counters remain durable in the existing outbox. Three
permanent failures quarantine only that event. Transient outages never quarantine data.
On restart the worker scans durable pending rows without requiring any HTTP request.
At-least-once hints may duplicate after publish-before-ack crashes; state effects stay in
the authoritative mutation transaction and clients reconcile/deduplicate snapshots.

An in-process Next timer was rejected because serverless functions can freeze without
traffic. A hosted cron/queue was not selected because no isolated authorized hosted target
is available and it would introduce deployment dependencies. A separate worker uses the
existing runtime and requires explicit operator supervision at release, not an implicit
production deployment. No schema or provider/API change is necessary.

## Risks recalled / checks applied

L-001..004: exact source and permanent evidence, distinguish local/hosted results.
L-033/034: retain competing-policy restrictive fences and signed room identity.
L-060/063: server-only Node condition; fail closed when configuration/schema is absent.
L-064/GH-52: private_only startup; retention-safe cleanup; exclusive disposable ownership.
No autonomous claim based on a snapshot/GET or request-driven notification path.

## Execution / acceptance

- [ ] Write failing worker tests: timer-only progress, non-overlap/stop, fair page cursor,
  error continuation, bounded configuration and per-room failure isolation.
- [ ] Implement worker loop, pending-room scanner and CLI, reusing existing locks/publisher.
- [ ] Verify real PostgreSQL two-worker serialization, transient retry, permanent poison,
  restart and commit-before-publication recovery with all app HTTP traffic withheld.
- [ ] Extend merged GH-52 two-instance harness with independently running worker processes;
  preserve its existing controls and add no-request recovery plus client2..5/privacy proof.
- [ ] Run private WS/JWT/RLS guards against the healthy synthetic local stack.
- [ ] Commit source; exact-HEAD clean install, guards, lint, typecheck, unit, integration,
  build, E2E, bundle scan and all local real-service qualifications. Preserve failures.
- [ ] Self-review full diff; publish receipt, summary, sanitized command outputs, Notion
  status/evidence/lessons and independent-review handoff. Do not spawn that reviewer here.

## Review focus

- Busy/failed room must not starve later rooms or create overlapping worker sweeps.
- Killing a worker with a transaction held must release its PG lock on disconnect.
- Publish succeeded but commit/ack failed must remain safe under duplicate delivery.
- No LIKE/SKIP or outbox payload escapes the version-only publisher/replay contract.
- Hosted acceptance remains BLOCKED/NOT RUN: shared CineMatch project has no development
  branches; shared schema, global RLS, public-channel setting and secrets are not authorized.
