# CINE-018 realtime work in progress

This branch is **not release or review ready** until the real hosted private-channel qualification in issue #20 succeeds. No migration or Realtime setting is applied by this branch. In particular, project-wide `Allow public access` must be disabled by the authorized operator on the correct target before live qualification or release. The policy migration targets `realtime.messages`; review its effects with existing policies and roles before applying it. Rollback must be separately governed; the `permanent_retry_count` column records permanent failures and dropping it loses that history.

The server uses `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_JWT_SECRET` as server-only configuration. Browser consumers construct `startRoomRealtime` with a public project URL and publishable key, a room UUID, and a snapshot callback. Each room owns a distinct Supabase client; connect first, fetch an authenticated snapshot after subscription, refresh the JWT, and poll the snapshot to repair an otherwise invisible dropped final event. The replay endpoint returns version numbers only. Room state is taken only from authenticated database snapshots.

Each committed outbox row is published as a version-only hint; no vote choice, event payload or secret is broadcast. The dispatcher takes a per-room advisory transaction lock and processes at most three events per call. The HTTP fast path remains for latency, but durable recovery is provided by a separate autonomous worker process, not by later user requests. Three permanent 413 rejections quarantine a row; transient provider failures never trigger quarantine. Clients reconcile by snapshot if a gap occurs. Delivery is at least once and may duplicate after publish-before-ack crashes; exactly-once domain effects remain in the authoritative mutation transaction.

## Autonomous worker operation

Run `npm ci` (including the existing tsx runtime dependency in devDependencies), then
`npm run realtime:worker` in a separately supervised process with server-only PostgreSQL,
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` configuration. The worker does not load arbitrary
env files automatically. `CINEMATCH_OUTBOX_SCHEMA` defaults to `public`; schema identifiers
are validated and migration 005 is checked before readiness. Missing PostgreSQL or an
invalid provider/schema configuration fails closed; there is no SQLite publishing fallback.
SQLite domain APIs and snapshot/replay behavior remain unchanged.

For the synthetic GH-52 local stack only (health-check it first):

```powershell
$env:NODE_ENV = 'development'
node --env-file=supabase/.env.app.local --conditions=react-server --import tsx scripts/realtime-worker.ts
```

The worker continuously scans pending non-poison room IDs using a UUID keyset cursor,
20 rooms per sweep, one sweep at a time. The default delay between sweeps is 1000ms;
`CINEMATCH_OUTBOX_POLL_MS` accepts only integer 100..60000ms. An empty page wraps the cursor,
so a busy/failed room cannot indefinitely block later rooms. Retry rate/work per sweep is
bounded, not a busy loop; transient retries remain indefinite for eventual availability.
Durable retry/quarantine counters survive process restarts. No additional migration or
state table is required. Worker and HTTP senders share the same per-room PostgreSQL
transaction advisory lock (250ms lock wait); publisher calls timeout at 1500ms. The worker
pool has two connections, 5s statement and 7s query timeouts, and handles idle connection
errors without exposing configuration in logs.

SIGINT/SIGTERM stop scheduling, drain the active room, then close the pool. A hard process
kill rolls back an uncommitted dispatch acknowledgement and releases the database lock;
the next worker retries the durable row. Duplicate hints after a successful publish and
lost acknowledgement are expected and must not create duplicate match state/animation.
An operator must supervise/restart the separate process in the eventual release setup;
serverless Next.js request processes alone do not provide this liveness guarantee.
No supervisor, production worker or hosted scheduler is deployed by this PR.

## Qualification and hosted boundary

`tests/local-supabase/outbox-worker-qualification.ts` tests real PostgreSQL ordering,
two concurrent worker loops, visibility only after commit, transient retry, permanent
quarantine, healthy-room progress, publish-before-ack duplication and restart in an
exclusively created disposable schema. Its publisher faults are simulated and are not
Supabase transport evidence.

`tests/local-supabase/two-instance-qualification.cjs --app-commit <full SHA>` uses merged
GH-52 real services, two independent Next.js copies, real browser clients and 2..5 signed
private WS clients. The no-traffic window stops browser polling, kills a process immediately
after an actual authority transaction commits (before any publication call), then launches
independent worker processes. It waits for WS receipt and database acknowledgement before
resuming any app HTTP. It repeats after stopping/restarting dispatchers. This explicitly
replaces GH-52's earlier request-assisted GET experiment; it must not be described as
autonomous PASS until its exact-HEAD evidence is published. Existing security, reconnect,
gap replay, privacy, production-loopback denial and latency controls remain required.

Read-only hosted inventory on 2026-11-17 found the shared CineMatch project with no
development branches. No shared project-wide Realtime/RLS/schema/secrets mutation is
authorized. Hosted qualification is **BLOCKED / NOT RUN**, independently of local results.
Minimum unblock: provision/identify a dedicated disposable test project or development
branch, explicitly authorize its identity and destructive synthetic qualification scope,
provide its test-only PostgreSQL/server/JWT/publishable credentials, and have an authorized
operator establish private-only Realtime plus canonical migrations/policies. Re-run the
entire hosted security/transport matrix there; do not relabel local PASS as hosted PASS.
Independent final review and owner acceptance remain required. CINE-019/021 are untouched.

### Legacy hosted-test safety incident

The first candidate's default `npm test` inadvertently enabled the legacy CINE-012 hosted
suite because its loader imported historical destructive consent from `.env.test.local`.
That was an execution error, not authorization: see the preserved incident and failure
record on issue #20. The suite created/dropped its temporary owned schema; a subsequent
read-only query confirmed that schema absent. Teardown's public table-count comparison
was not a comprehensive global-effects audit. No further hosted mutation was performed.

The automatic suite now reads only PG credential keys from that file. Destructive consent
must come from the current invocation's `ALLOW_DESTRUCTIVE_PG_TESTS=true`, never file content;
synthetic negative tests cover refusal and configuration injection. Offline qualification
explicitly sets `ALLOW_DESTRUCTIVE_PG_TESTS=false`. The owner secret file is not changed.
The historical hosted failures remain FAIL evidence, not authorized hosted acceptance;
the isolated hosted gate above remains BLOCKED/NOT RUN.
