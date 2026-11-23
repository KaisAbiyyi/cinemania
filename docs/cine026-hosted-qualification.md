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

`gate-a-only` mode runs only the five targeted browser cases, then Gate D cleanup and independent readback. Gates B and C stay `NOT RUN` even when Gate A passes. Its distinct success verdict is `WARM-PATH GATE A ONLY PASSED; COLD-PATH NOT QUALIFIED`, which is never complete A–D acceptance and never a cold-path result. Both workload modes begin with a bounded Realtime warm-up, described below. The `full` workflow runs the five targeted cases, hosted worker proof and 39 browser cases in order. Each workload invokes the existing PostgreSQL qualification lease and the supervisor's post-release read-only audit. Repository concurrency prevents overlapping Actions jobs. The exclusive window must also cover any local or other external staging users.

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

## Realtime warm-up and the two evidence classes (`gate-a-only` and `full`)

The cold-start probe (above, run 45274114936) showed that the first private broadcast after the Supabase Realtime tenant has shut down took 2632 ms (2481 ms at the provider, with a 1335 ms `CheckConnection`), while later broadcasts to the same or other rooms took 377 to 428 ms. The application publisher's 1500 ms deadline is therefore shorter than a tenant start. Hosted gates are split into two evidence classes so that neither can be mistaken for the other.

### Warm-path acceptance (this workflow)

`gate-a-only` and `full` first run a **qualification-only Realtime warm-up**, labelled `Realtime warm-up (qualification-only)` in the job summary and `warmup` in the evidence artifact. It warms Realtime itself, not `GET /auth/v1/health` (a different service that does not start the tenant).

- Exactly three private-broadcast POSTs with the application's endpoint, headers and body shape, to synthetic random topics. No retries, no PostgreSQL access, no application rows, a 20 s wall limit.
- `W1` starts the tenant (10 s diagnostic deadline, must return HTTP 202). `W2` and `W3` go to two further synthetic rooms and must each return HTTP 202 within 1500 ms (the application deadline, used here only as a readiness bar).
- **Fail-closed.** A 401, 403, any other status, a timeout, a transport error or a slow verification is `NOT_READY`. The run then stops before Gate A with `WARMUP_NOT_READY`; gates stay `NOT RUN` and the verdict is `HOLD`.
- The warm-up holds the exclusive staging lease on its own session. It releases the lease with confirmation and an independent fresh session reads the empty baseline back (one bounded 135 s quiet window) **before** any workload starts. The workload then takes its own lease exactly as before. An unconfirmed release or readback stops the run (`WARMUP_CLEANUP_UNCONFIRMED`, Gate D `UNCONFIRMED`).
- `firstRequestOverAppDeadline` is a latency classification. Whether the tenant really started is confirmed separately in the provider's `realtime_logs`. The evidence also records `completedAt` and each workload's `startedAt`.
- Not changed: the application, its 1500 ms deadline, retry policy, database pool, the zero-transport-failure gate, credentials handling and the existing preflight. A transport failure during a gate still fails that gate.

Verdicts are labelled by what they prove:

| Mode | Success verdict | Meaning |
| --- | --- | --- |
| `gate-a-only` | `WARM-PATH GATE A ONLY PASSED; COLD-PATH NOT QUALIFIED` | Five targeted cases passed on a warmed tenant. Not A-D acceptance. |
| `full` | `WARM-PATH ACCEPTANCE: ALL GATES PASSED; COLD-PATH RECOVERY NOT QUALIFIED` | Gates A to D passed on a warmed tenant. |

The evidence also carries `coverage: { warmPathAcceptance, coldPathRecovery }`, where `coldPathRecovery` is always `NOT QUALIFIED` in these modes. A passing warm run never claims that the cold path passed.

Limitation: the warm-up is performed once, before Gate A. Hosted gates keep browser clients connected, which keeps the tenant running, and the earlier Gate A-only run took about 3.5 minutes from start to cleanup. Provider logs showed a tenant ending about 10 minutes after it started with no connected users. If the tenant went idle between gates, a later transport failure is still reported by the existing diagnostics and still fails the gate. It is never masked.

### Cold-path recovery (separate criterion, design only, not implemented)

Cold-path recovery asks what a user experiences when the first room event after tenant idle is published. It is a different question from warm-path correctness and needs its own run: a future infrastructure PR would add a mode that deliberately skips the warm-up and runs one scenario against a tenant confirmed shut down in `realtime_logs`. This document defines what that run must record. It does **not** set a service-level objective.

| Measure | Definition | Existing evidence source |
| --- | --- | --- |
| First-publish latency | Time of the first provider request after idle, split into client, provider (`Sent 202 in N ms`) and tenant start (`CheckConnection`). | Cold-start probe; transport diagnostics (`ms`, `category`, `phase`). |
| Bounded outbox recovery | Time from the first failed attempt to the outbox marking the event delivered, and the number of attempts. | `CINE026_TRANSPORT_DIAGNOSTICS` (`outbox`, `observedAfterFailureMs`, outcomes). |
| First-event delivery latency | Time from the event's durable receipt to the private WebSocket frame at a subscriber, and to a GET that started after that frame. | Browser convergence evidence (`hintAfterAnchorMs`, `snapshotStartAfterAnchorMs`, `renderedAfterAnchorMs`). |
| Ordering | Versions seen by every client are monotonic with no gap or duplicate, including the event that was retried. | Convergence evidence and version checks. |
| Resource impact | Connection-seconds held under the per-room advisory lock, peak advisory waiters, lock timeouts, peak sessions against the pooler budget. | Hosted metrics `counts` and `peaks`. |

Rules for using the measurements:

1. A cold-path run is repeated only as often as the exclusive window and the idle time between samples allow; every sample is reported with min, median and max, never a single pass or an average alone.
2. A cold-path SLO is proposed by the owner from the observed distribution and the product's tolerance for a delayed first event, then reviewed independently before adoption. Until then the criterion is `NOT QUALIFIED` and the measurements are informational.
3. If warm-path acceptance passes but the cold-path distribution is unacceptable, an application-side remediation is scoped as a separate task with before-and-after latency and pool profiles, including the connection-hold trade-off of any longer deadline inside the outbox lock.

## Anggaran supervisor dan preservasi bukti

Run 45281615554 mencatat WebKit mulai pukul 22:59:20.362 UTC. Pada 23:06:20.373 UTC, batas 420 detik menghentikan supervisor walaupun Playwright mencatat 3/3 lulus. Artefak tidak memuat fase terakhir, ringkasan transport, atau metrik cleanup WebKit. Waktu yang sama sebelumnya dipakai untuk build, eksekusi tes dan teardown. Bukti tersebut mengonfirmasi persaingan anggaran, sedangkan aktivitas teardown yang sedang berjalan saat cutoff tidak dapat ditentukan.

Supervisor Actions memakai adapter terhadap hook kandidat yang sudah dipin. Guard project, lease, cleanup fixture, dan audit read-only setelah pelepasan lease tetap dijalankan oleh supervisor kandidat. Batas publisher, konfigurasi pool, retry dan assertion Playwright tetap.

| Anggaran | Batas |
| --- | --- |
| Eksekusi nominal | Gate A 7 menit per browser, Gate B 19 menit, Gate C 55 menit. Build dan child workload memakai anggaran ini. |
| Teardown per workload | 240 detik sejak child selesai atau supervisor diminta berhenti. Cadangan ini mencakup quiet window 135 detik, penyelesaian child/monitor, pemeriksaan port, pelepasan lease, dan audit SQL dengan koneksi baru. |
| Eskalasi dan ceiling absolut | SIGTERM hanya dikirim ke supervisor untuk meminta teardown. Jika teardown melewati batas, grup proses mendapat SIGKILL paling lambat setelah 6 detik. Ceiling per workload adalah anggaran eksekusi yang tersedia + 240 detik + 6 detik. |
| Job kualifikasi | Tetap 120 menit. Jam dimulai dari langkah pertama job kualifikasi. Sebelum tiap workload, waktu untuk cleanup, eskalasi dan tiga menit untuk penutupan/upload disisihkan. Workload berikutnya tidak dimulai jika sisa waktu tidak cukup. |

Anggaran eksekusi nominal A/B/C berjumlah 95 menit. Lima cadangan teardown dan eskalasi berjumlah 20 menit 30 detik. Menjumlahkan batas nominal dengan setup dan warm-up secara bersamaan bisa melampaui 120 menit. Anggaran eksekusi efektif setiap tahap karena itu dihitung ulang dari waktu job yang tersisa. Kekurangan waktu atau timeout yang benar-benar terjadi menghasilkan HOLD. Skenario, assertion serta ambang transport dan status tetap utuh.

Artefak diperbarui secara atomik saat fase berubah, saat ringkasan transport parsial tersedia, dan saat hasil akhir diterima. Status `partial` menandai checkpoint dengan verdict HOLD. Hasil akhir mencantumkan fase terakhir, timeout yang terjadi, dan bukti terminal yang hilang. Counter parsial dapat membantu diagnosis tetapi tidak mengesahkan Gate A–D. Cleanup memerlukan laporan supervisor yang lengkap, pelepasan lease terkonfirmasi dan readback nol dari sesi baru. Timeout saat eksekusi tetap menggagalkan gate meskipun cleanup berhasil. Jika job dihentikan sebelum langkah upload berjalan, checkpoint lokal mungkin tidak tersedia sebagai artefak Actions.

[Run 45281615554](https://github.com/KaisAbiyyi/cinemania/actions/runs/45281615554) · [Review independen](https://github.com/KaisAbiyyi/cinemania/pull/66#pullrequestreview-6031016598).
