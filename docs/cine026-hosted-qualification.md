# CineMatch Ubuntu staging qualification

The qualification workflow runs the reviewed integration candidate on GitHub-hosted Ubuntu 24.04. The initial candidate is PR #66 at `00555c03d4173ac54750677207b78252e2063257`. The bootstrap PR targets `main` and leaves PR #66 unchanged. GitHub requires the workflow file on the default branch before it accepts `workflow_dispatch`. Merge the infrastructure PR through the normal owner review process. [GitHub dispatch rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

## Configure the staging environment

Open **Cinemania → Settings → Environments → cine026-staging**. Deployment branches and tags must use **Selected branches and tags** with the single branch rule `main` and no tag rules. Leave administrator bypass disabled. Store the inputs in **Environment secrets** or **Environment variables** as shown below.

Use only existing approved values from the CineMatch staging project `dmrbticnsczhyaiftrar`. Never put them in an issue, chat, repository-wide secret, commit, workflow input, or artifact. The project URL, database `postgres` and session port `5432` are fixed by the harness. Do not use the transaction pooler on port 6543. [Supabase database connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

| Name | Scope | Purpose and source |
| --- | --- | --- |
| `SUPABASE_PUBLISHABLE_KEY` | Environment variable | Browser Realtime client and preflight HTTPS probe. Use the existing publishable key from **Supabase → CineMatch → Settings → API Keys** or the approved staging file. |
| `SUPABASE_PG_HOST` | Environment variable | IPv4 staging session pooler host from **Supabase → CineMatch → Connect → Session pooler**. Copy the hostname only. |
| `SUPABASE_PG_USER` | Environment variable | Existing approved staging database role from the same Session pooler dialog or approved file. Use the qualified username with the project suffix. |
| `CINE026_SESSION_POOL_SIZE` | Environment variable | Verified capacity for the staging session pool. Read the pool size under **Supabase → CineMatch → Database → Settings → Connection pooling**. The most demanding existing harness stage budgets up to 10 sessions. Set a verified numeric capacity of at least 10 only when the configured pool supports it. |
| `SUPABASE_PG_PASSWORD` | Environment secret | Existing password for the approved staging database role. Get it from the approved local credential store or the role custodian. The Connect dialog gives endpoint metadata and may show a password placeholder. |
| `SUPABASE_SECRET_KEY` | Environment secret | Existing server-only staging credential used for private broadcasts. Use the approved secret key under **Settings → API Keys** or the approved staging file. It is elevated and must stay server-side. |
| `SUPABASE_JWT_SECRET` | Environment secret | Existing staging JWT signing secret used by the pinned private-channel implementation. Retrieve it from the approved staging file or **Settings → JWT Keys → Legacy JWT Secret** if available to your account. Public keys and legacy role tokens cannot substitute for the signing secret. |

The approved database role must support the pinned fixture creation, readback, and run-owned cleanup operations. No cloud management access token, deployment token, production credentials, or new credential is needed. Confirm the project's network policy already allows the GitHub-hosted runner to reach the session pooler and HTTPS origin. If it requires static IPs, preserve that restriction and resolve the runner choice separately. [GitHub-hosted networking](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#ip-addresses) · [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) · [Realtime custom JWTs](https://supabase.com/docs/guides/realtime/postgres-changes#custom-tokens).

## Verify and execute

Once the owner confirms the setup and an exclusive staging window, the qualification agent verifies the environment policy and configured names with GitHub's API. To list variable names without reading values, use the API with a field filter.

```sh
gh api repos/KaisAbiyyi/cinemania/environments/cine026-staging/secrets --jq '.secrets[].name'
gh api repos/KaisAbiyyi/cinemania/environments/cine026-staging/variables --jq '.variables[].name'
```

The agent dispatches the workflow on `main`, first in `preflight` mode. This verifies the pinned candidate, guarded staging TLS/HTTPS, project scope, capacity and empty state without creating fixtures. When it passes and the exclusive window is still confirmed, the agent dispatches a fresh `full` invocation with the same candidate and project, and `exclusive=true`. If the qualified window ends, require fresh consent. Use a new dispatch after diagnosis instead of GitHub's Re-run button, which reuses the prior invocation.

`gate-a-only` mode runs only the five targeted browser cases, then Gate D cleanup and independent readback. Gates B and C stay `NOT RUN` even when Gate A passes. Its distinct success verdict is `GATE A ONLY PASSED`, which is never complete A–D acceptance. The `full` workflow runs the five targeted cases, hosted worker proof and 39 browser cases in order. Each workload invokes the existing PostgreSQL qualification lease and the supervisor's post-release read-only audit. Repository concurrency prevents overlapping Actions jobs. The exclusive window must also cover any local or other external staging users.

The job checks cleanup even when a workload exits unsuccessfully. A timeout, cancelled job or lost runner can prevent cleanup from being confirmed. In that case keep the HOLD and verify the designated project with a fresh guarded read-only session before any retry. Only run-owned fixtures may be removed through authorized cleanup.

Read the Actions job summary and the `cine026-staging-evidence-<run id>` artifact. The artifact contains fixed case labels, outcomes, sanitized first-failure diagnostics, counts and timings. Browser video, screenshots, raw traces, child logs and credential files stay outside the upload path. A WebSocket frame and a GET that begins after that frame are reported separately. The agent uses the verified run and artifact links to update PR #66, both issues and both Notion tasks. The Actions job uses a read-only repository token throughout.

## Cold-start probe (`cold-start-probe` mode)

A diagnostic, never acceptance. It tests whether the first broadcast after the Supabase Realtime tenant has shut down is slower than the application publisher's fixed 1500 ms deadline. It sends one connection warm-up (`GET /auth/v1/health`, Auth rather than Realtime, so the first probe reuses an established TCP/TLS connection) and then exactly ten private broadcast POSTs to synthetic random topics, with the same endpoint, headers and body shape as the application publisher:

| Probe | Role | Question |
| --- | --- | --- |
| P1 | `cold_first` | Does the first request after tenant idle exceed 1500 ms? |
| P2, P4 | `warm_same_room` | Is the same room fast once the tenant is warm? |
| P3, P5 | `warm_other_room` | Is a different room fast on the same warm tenant (per-tenant or per-room effect)? |
| P6 to P10 | `warm_concurrent` | Do five concurrent rooms (the Gate A client count) stay fast? Reported separately from the verdict. |

Bounds: a 10 s diagnostic deadline per request, a 75 s wall limit, no retries, no repeat when the tenant turns out to be warm. The application deadline, retry policy, database pool and acceptance gates are untouched. The probe never opens a PostgreSQL connection except the exclusive lease session, never creates application rows, and records a request as accepted only on an HTTP 202 response. A written body without a response is reported as no response. Provider acceptance is not subscriber delivery; delivery stays covered by the browser gates.

Cleanup is fail-closed: the lease release must be acknowledged and an independent fresh session must read back the empty baseline (one bounded 135 s quiet window for retained pooler sessions), otherwise Gate D is `UNCONFIRMED` and the verdict is `HOLD`. Gates A to C stay `NOT RUN`.

Verdict codes: `COLD_START_REPRODUCED` (P1 above 1500 ms, sequential warm probes below it), `PER_ROOM_EFFECT_OBSERVED`, `WARM_PATH_NOT_CLEAN`, `INCONCLUSIVE_NOT_COLD` (the first request was already fast: the tenant was warm), `INCONCLUSIVE_FIRST_PROBE_FAILED`. The verdict is a latency classification. Whether the tenant really started up during P1 is confirmed separately with the provider's `realtime_logs` (`Connection process starting up`, `CheckConnection`, `Starting stream replication`, `POST /api/broadcast ... Sent 202 in N ms`). Before dispatching, confirm from those logs that the tenant has shut down (`Tenant ... has been terminated: :shutdown`) and has not started again. Dispatch once per exclusive window.
