# CINE-026 Test Layers

This guide keeps deterministic mocks, local Supabase, and hosted staging evidence separate.

## Mocked provider and local SQLite browser tests

Run `npm run test:e2e` for the existing Chromium suite, or `npm run test:e2e -- --config=playwright.cine026.mocked.config.ts` for the CINE-026 focused matrix. The focused config runs the local SQLite voting and finish-state regressions in Chromium, Firefox, and WebKit with the offline TMDB interceptor, a synthetic capability secret, and local SQLite opt-in. Existing CINE-023 create/join UI tests remain in the default Chromium suite; the cross-browser create/join contract is covered against hosted staging below. These local browser tests exercise the application and SQLite room API; **they do not qualify Supabase Realtime**. CINE-024 preview and CINE-025 route-fixture tests remain simulated UI coverage.

GitHub Actions installs all three browser engines for the focused CINE-026 run, executes the existing Chromium E2E batches, retains screenshots and video on failure, and uploads separate reports for existing and CINE-026 tests.

## Real local Supabase and Realtime

From the repository root on a machine with Docker Desktop running:

```powershell
npm ci --prefix scripts/local-supabase
npm --prefix scripts/local-supabase run test:guards
$sha = git rev-parse HEAD
npm --prefix scripts/local-supabase run start -- --commit $sha
npm --prefix scripts/local-supabase run test:rls-ws
npm --prefix scripts/local-supabase run test:two-instances
npm --prefix scripts/local-supabase run stop
```

This uses the repository's loopback-only disposable Supabase stack and synthetic credentials. It must not run with hosted cloud-target variables set. The GitHub `Local Supabase Realtime Qualification` job runs the safety, RLS/WebSocket, and two-instance suites against a fresh local Compose stack at the workflow SHA. These are real PostgreSQL/Realtime checks; they are not browser UI or hosted staging tests.

## Hosted staging browser matrix

Use only the owner-designated CINE-018 staging file after its exact project and empty-room safety guards pass. In PowerShell:

```powershell
$env:CINE018_STAGING_PROJECT = 'dmrbticnsczhyaiftrar'
$env:CINE018_STAGING_ENV_FILE = 'C:\path\to\owner-designated-staging-file'
npm run test:e2e:cine026:staging
```

The runner validates the exact Supabase origin and direct/session PG target, refuses a non-empty `public.rooms` table, builds the application with staging Realtime config, uses the offline TMDB interceptor, and runs the dedicated Playwright suite serially in Chromium, Firefox, and WebKit. Tests use 2–5 independent browser contexts (plus one explicit sixth-player rejection attempt), actual authenticated room APIs, private Supabase WebSockets, and the server-authoritative snapshot. The test suite removes only room IDs it created with this run's `C026-*` host marker; cleanup verifies exact IDs, creation time, and ownership first. If interrupted before cleanup, the empty-table guard blocks a subsequent run for manual inspection.

This hosted suite is a staging check, never production validation. Its credentials are not available to GitHub CI and must not be committed or printed. CI results alone cannot claim hosted Realtime acceptance.

## Qualification limits to keep explicit

- The routed real Supabase WebSocket interruption and recovery currently passes in Chromium and Firefox. Playwright's WebSocket routing callback is not invoked for the WebKit connection, and offline toggling did not produce a client socket-close event within 15 seconds. WebKit's direct interruption criterion remains **NOT VERIFIED**; do not count `navigator.onLine` or later application refresh as proof of a socket interruption.
- Hosted staging checks authenticated REST isolation between two rooms. The GitHub local Supabase qualification separately attempts a Room A token on Room B's private channel, then verifies a Room A server broadcast reaches only Room A's authorized WebSocket. Do not collapse these into a single mocked or hosted claim.
- The 90-second grace test creates a controlled stale participant by backdating only the exact run-owned staging row, verifies the row is older than the grace interval, and then reads the server-authoritative transition. It does not measure a naturally elapsed 90-second interval.
- Local Supabase RLS/WebSocket and two-instance recovery are exercised in the GitHub-hosted disposable Docker job. The developer workstation had no Docker Desktop daemon during this run, so no local Compose run is claimed.
- Local Supabase broadcast delivery is awaited by a bounded event-driven waiter; the suite does not rely on a fixed post-publish sleep.
