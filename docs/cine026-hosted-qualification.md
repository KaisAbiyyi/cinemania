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

> `full` is currently refused by the consent step before any staging step (`FULL_MODE_NOT_ADMITTED`); see the last section. Statements below about `full` describe the verdict logic that remains in code, not an admitted mode.

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
| Eksekusi | Gate A diturunkan dari batas kasus yang dideklarasikan spec kandidat (lihat bagian terakhir): Chromium dan Firefox 465 detik, WebKit 1245 detik. Gate B 19 menit dan Gate C 55 menit tetap nominal. Build dan child workload memakai anggaran ini. |
| Teardown per workload | 240 detik sejak child selesai atau supervisor diminta berhenti. Cadangan ini mencakup quiet window 135 detik, penyelesaian child/monitor, pemeriksaan port, pelepasan lease, dan audit SQL dengan koneksi baru. |
| Eskalasi dan ceiling absolut | SIGTERM hanya dikirim ke supervisor untuk meminta teardown. Jika teardown melewati batas, grup proses mendapat SIGKILL paling lambat setelah 6 detik. Ceiling per workload adalah anggaran eksekusi yang tersedia + 240 detik + 6 detik. |
| Job kualifikasi | Tetap 120 menit. Jam dimulai dari langkah pertama job kualifikasi. Sebelum tiap workload, waktu untuk cleanup, eskalasi dan tiga menit untuk penutupan/upload disisihkan. Workload berikutnya tidak dimulai jika sisa waktu tidak cukup. Sebelum membuka preflight untuk mode workload, runner juga mencadangkan 150 detik untuk preflight dan delapan menit untuk warm-up beserta readback. Sisa waktu dicek lagi sebelum warm-up. |

Anggaran eksekusi nominal A/B/C berjumlah 95 menit. Lima cadangan teardown dan eskalasi berjumlah 20 menit 30 detik. Menjumlahkan batas nominal dengan setup dan warm-up secara bersamaan bisa melampaui 120 menit. Anggaran eksekusi efektif setiap tahap karena itu dihitung ulang dari waktu job yang tersisa. Kekurangan waktu atau timeout yang benar-benar terjadi menghasilkan HOLD. Skenario, assertion serta ambang transport dan status tetap utuh.

Artefak diperbarui secara atomik saat fase berubah, saat ringkasan transport parsial tersedia, dan saat hasil akhir diterima. Status `partial` menandai checkpoint dengan verdict HOLD. Hasil akhir mencantumkan fase terakhir, timeout yang terjadi, dan bukti terminal yang hilang. Counter parsial dapat membantu diagnosis tetapi tidak mengesahkan Gate A–D. Ringkasan transport terminal yang kosong juga tidak membuktikan nol kegagalan. Respons non-2xx pada ringkasan terminal tetap menggagalkan gate, termasuk penolakan yang dicatat terpisah dari counter status supervisor. Kandidat sekarang menahan log proses app/worker turunan Gate B ketika sukses. Jika laporan transportnya kosong, recovery proof Gate B tidak cukup untuk PASS dan pengambilan bukti transport turunan perlu ditangani sebelum acceptance full. Cleanup memerlukan laporan supervisor yang lengkap, pelepasan lease terkonfirmasi dan readback nol dari sesi baru. Timeout saat eksekusi tetap menggagalkan gate meskipun cleanup berhasil. SIGKILL grup tidak mencakup program yang telah membuat grup terpisah, seperti server yang diluncurkan Playwright dalam keadaan detached. Jalur paksa tetap UNCONFIRMED dan membutuhkan audit read-only terpisah setelah job. Jika job dihentikan sebelum langkah upload berjalan, checkpoint lokal mungkin tidak tersedia sebagai artefak Actions.

[Run 45281615554](https://github.com/KaisAbiyyi/cinemania/actions/runs/45281615554) · [Review independen](https://github.com/KaisAbiyyi/cinemania/pull/66#pullrequestreview-6031016598).

## Anggaran turunan, progres terstruktur, dan bukti proses turunan (epoch 10)

Run [45328006067](https://github.com/KaisAbiyyi/cinemania/actions/runs/45328006067) (`gate-a-only` pada `main` `0c3cc6f`): preflight dan warm-up lulus, Chromium 1/1 dan Firefox 1/1 lulus dengan cleanup terverifikasi, WebKit mencapai `WORKLOAD_EXECUTION_TIMEOUT` pada batas eksekusi tanpa laporan Playwright. Transport WebKit sebelum timeout: 40 dari 40 HTTP 202, tanpa kegagalan. Bagian ini memisahkan penyebab yang dapat dibuktikan dari sumber, hipotesis yang belum terbukti, dan alat ukur yang ditambahkan agar dispatch berikutnya dapat membedakannya.

### Konflik anggaran 420 detik dan test 600 detik (diamati dari sumber)

Spec kandidat `00555c0` menetapkan 180 detik untuk setiap kasus (blok describe), 240 detik untuk kasus host-grace alami, dan `test.setTimeout(600000)` untuk kasus exhaustion dua puluh kartu. Tiga kasus WebKit pada Gate A (interupsi socket halaman yang sama, transport cut, exhaustion) berjalan serial dalam satu workload. Batas lama 7 menit per workload tidak dapat memuat batas deklarasi kasus itu (180 + 180 + 600 detik) ditambah startup. Test pembanding di `execution-budget.test.cjs` membaca spec yang dipin dan gagal jika repin mengubah batas yang disalin.

Anggaran baru dihitung, bukan sekadar dinaikkan: `startup + jumlah batas kasus terpilih + margin pelaporan`. Startup 255 detik = `webServer.timeout` 120 detik (konfigurasi staging) + kesiapan worker 15 detik (150 polling x 100 ms) + allowance `next build` 120 detik (supervisor kandidat tidak membatasinya; teramati 2 sampai 21 detik). Margin pelaporan 30 detik.

| Workload Gate A | Kasus (batas deklarasi) | Anggaran eksekusi |
| --- | --- | --- |
| Chromium | 1 x 180 detik | 465 detik |
| Firefox | 1 x 180 detik | 465 detik |
| WebKit | 180 + 180 + 600 detik | 1245 detik |

Anggaran tetap terbatas dan dipotong oleh ceiling job 120 menit lewat `planWorkload`. Pemotongan dicatat sebagai `budgetBinding` pada workload, sehingga timeout karena ceiling dapat dibedakan dari child yang macet. Sebelum staging disentuh, runner menolak Gate A jika jumlah ketiga anggaran, cleanup dan grace tidak muat dalam sisa job (`WORKFLOW_BUDGET_EXHAUSTED`). Worst case Gate A: 2175 detik eksekusi + 738 detik cleanup dan grace. Timeout per kasus tetap ditegakkan oleh Playwright. Tidak ada assertion, timeout kasus, atau ambang transport yang berubah.

**Keterbatasan `full` (kini diblokir fail-closed sebelum staging, lihat bagian mode `full`; mengangkatnya perlu keputusan owner dan review terpisah):** batas deklarasi tiga browser x 13 kasus berjumlah 2820 detik per browser, sekitar 146 menit dengan startup, lebih dari ceiling 120 menit. Anggaran nominal Gate B 19 menit dan Gate C 55 menit tidak dihitung ulang di PR ini. Gate C kemungkinan tidak muat dalam satu job pada laju yang teramati (perkiraan, belum diukur: exhaustion saja sekitar 7 menit per browser). Opsi yang perlu diputuskan terpisah: memecah `full` per browser, atau menaikkan ceiling job dengan alasan yang direview. Test `the full matrix cannot be guaranteed inside one 120 minute job` menjaga klaim ini.

### Progres terstruktur per kasus

Reporter `progress-reporter.cjs` (milik repositori workflow, dimuat dengan `--reporter=json,<path>`, kandidat tidak diubah) mencetak baris `CINE026_PROGRESS` yang hanya memuat indeks kasus pada seleksi, status enum, durasi, batas kasus, penghitung langkah per kategori, jumlah POST API, serta durasi `Before Hooks` dan `After Hooks`. Judul kasus, judul langkah, URL, locator, pesan error, attachment, dan payload tidak pernah dicetak (test memakai judul dan URL kanari, termasuk dengan Playwright asli). `printsToStdio()` bernilai true agar Playwright tidak menambah reporter dot yang menempelkan karakter di depan baris. Akibatnya reporter dot juga tidak lagi mencetak output `webServer` (server aplikasi) dan output kasus, padahal di situlah server aplikasi menulis baris `[CINEMATCH_REALTIME_*]` (celah bukti T1, run 45775582526). Karena itu reporter ini meneruskan output stdout/stderr `webServer` dan kasus ke stderr prosesnya sendiri, baris demi baris (potongan pipe yang terbelah disambung kembali), agar supervisor dapat menghitungnya. Teks yang diteruskan tidak diparse atau disimpan oleh reporter, dan hanya dibaca supervisor melalui allowlist-nya.

Adapter supervisor menambah `CINE026_DB_SAMPLE` dari hasil `readState` milik monitor kandidat setiap 3 detik: jumlah votes, events, pending, rooms, participants, advisory waiters, idle transactions, usia pending tertua, dan waktu round trip pembacaan itu. Tidak ada sesi atau statement baru; wrapper pasif. Progres exhaustion 20 putaran diturunkan dari kenaikan jumlah votes (dua permintaan vote per putaran, 40 vote untuk 20 putaran), bukan dari judul langkah. Ini turunan, bukan pengukuran langsung per putaran.

Ledger `workload-progress.cjs` membangun ulang semuanya dari enumerasi dan integer terbatas. Waktu memakai jam kedatangan supervisor, bukan stempel dari anak. Seri sampel dibatasi 40 titik (puncak disimpan terpisah), kasus 24, stream proses turunan 16. Saat timeout, progres diklasifikasi `CASE_ACTIVE_PROGRESSING` atau `CASE_ACTIVE_STALLED` (ambang 150 detik: tunggu diam terpanjang yang dideklarasikan, 100 detik, ditambah 50%), `BETWEEN_CASES_*`, `RUN_ENDED`, atau `NO_PROGRESS_EVIDENCE`. Klasifikasi hanya atribusi; timeout tetap HOLD.

Jika Playwright sudah melaporkan `run_end` tetapi supervisor kandidat tidak masuk fase `teardown` dalam 120 detik, workload dihentikan sebagai `PLAYWRIGHT_TEARDOWN_STALLED` (HOLD) alih-alih menunggu sisa anggaran eksekusi. Pemeriksaan ini membedakan teardown yang macet dari kasus yang lambat. Quiet window 135 detik berada sesudah fase `teardown` dan tidak memicunya.

### Celah diagnostik proses turunan Gate B

`two-instance-qualification.cjs` kandidat menyimpan hanya ekor kecil output proses Next, worker dan committer turunan dan mencetaknya saat gagal, sehingga nol kegagalan transport tidak dapat dibedakan dari bukti yang hilang. `nested-stream-tap.cjs` dimuat dengan `--require` hanya pada proses Gate B, membungkus `child_process.spawn`, dan untuk setiap proses turunan app, worker dan fault mencatat nomor generasi, apakah stream output terpasang (`piped`), jumlah baris yang diteruskan dan dibuang, serta cara berakhir. Proses lain (misalnya browser yang diluncurkan Playwright) tidak dipasangi dan tidak dilaporkan. Preload dilepas dari `NODE_OPTIONS` proses turunan.

**Sanitasi di sumber.** Baris mentah tidak pernah diteruskan. `nested-stream-lines.cjs` membangun ulang baris kanonik dari field yang diizinkan (`r` delapan heksadesimal, `v`, `ms`, `kind`, `status`, `category`, `code`, `phase`, `startedAt`, `attempt`, `outcome`, dengan pola nilai ketat) atau mengembalikan null. Teks bebas, host, identifier, dan field tambahan dibuang sebelum baris meninggalkan proses turunan (test memakai kanari rahasia pada setiap tag). Parser diagnostik kandidat dan counter supervisor tetap membaca baris kanonik yang sama, sehingga hitungan `providerTransport`, `providerStatus`, `capacity`, `lockTimeout` dan reset ikut mencakup proses turunan. Batasnya: sanitasi ini menjamin isi baris yang diteruskan, bukan bahwa proses turunan tidak menulis hal lain ke pipenya sendiri (itu tetap di dalam proses Gate B dan tidak dipublikasikan).

**Kelengkapan.** Gate B hanya dapat PASS jika `nestedProblems` kosong. Rencana generasi adalah tepat, bukan minimum, dan diturunkan dari titik panggilan pada jalur sukses sumber yang dipin: 3 app (dua instance awal dan instance pertama setelah committer dibunuh), 5 worker (dua awal, dua setelah restart pertama, satu setelah restart kedua), dan 2 committer fault. Test menghitung titik panggilan itu pada sumber yang dipin sehingga repin yang mengubahnya gagal. Setiap generasi harus:

- punya catatan spawn berurutan tanpa lompatan nomor, dan stream app dan worker terpasang (committer fault berjalan dengan stdio diabaikan oleh desain dan tidak diwajibkan);
- punya catatan terminal `exit`. Spawn tanpa exit, atau diam, tidak pernah dianggap bersih;
- tidak berakhir dengan crash tak terduga (kode non-nol tanpa sinyal). Pembunuhan yang disengaja (restart, cleanup) sah;
- tidak perlu menghasilkan lalu lintas HTTP, karena generasi yang sengaja idle tetap sah.

Catatan duplikat, tidak berurutan, tanpa spawn (orphan), malformed, atau melebihi tabel (16 stream) dihitung sebagai `invalid` dan menolak Gate B. Terakhir, untuk setiap generasi jumlah baris kanonik yang diterima pembaca luar harus tepat sama dengan jumlah yang dilaporkan diteruskan. Kelebihan pada satu generasi tidak menutupi kehilangan pada generasi lain. `exit` membawa tally pada saat itu karena `close` dapat tertunda jika turunan memegang pipe. Evidence Gate B memuat `nestedProblems` sebagai daftar enumerasi.

### Relay adapter ke pembaca luar (epoch 11)

Baris anak workload hanya terlihat oleh adapter (`runSupervisor`). Sebelum epoch 11 adapter tidak meneruskan `CINE026_PROGRESS` dan `CINE026_NESTED`, sehingga ledger, watchdog `run_end` dan akuntansi Gate B tidak dapat bekerja pada jalur hosted ([review R2](https://github.com/KaisAbiyyi/cinemania/pull/75#pullrequestreview-6035810251)). `event-relay.cjs` kini menjadi satu-satunya jalan:

- Event diterima hanya bila field-nya tepat sama dengan skema (tanpa field tambahan) dan setiap nilai berupa enumerasi, boolean, atau integer terbatas. Baris yang dikirim dicetak ulang dari nilai tervalidasi.
- Baris yang menyebut prefix tetapi tidak valid (termasuk terpotong, tertempel teks lain, terlalu panjang, atau berasal dari anak yang salah) menjadi penanda tetap `{"ev":"rejected"}`, paling banyak 64 per workload. Teks aslinya tidak ikut. Pembaca luar menghitungnya sebagai penolakan.
- `CINE026_PROGRESS` hanya dari proses Playwright, `CINE026_NESTED` hanya dari proses Gate B. Build dan worker mandiri tidak boleh mengirim keduanya.
- Tap memberi asal pada setiap baris kanonik (`CINE026_STREAM <kind> <generasi>`). Adapter memeriksa bahwa teksnya kanonik, lalu hanya meneruskan asalnya (`ev: diagnostic`). Counter kandidat dan parser transport tetap membaca baris itu di dalam adapter.

**Gate A** kini juga memerlukan `progressProblems` kosong: reporter terlihat, tanpa event reporter yang ditolak, jumlah seleksi cocok, setiap indeks mulai dan selesai tepat satu kali dengan `passed`, dan `run_end` `passed`. Ini syarat tambahan yang fail-closed. Laporan Playwright, metrik terminal, transport, dan cleanup tetap wajib seperti sebelumnya.

**Kelengkapan transport (semua gate)** memerlukan `transportProblems` kosong. Sampel DB monitor kini memuat `poison` dan `retries` (jumlah `retry_count`), dan ledger menjumlahkan setiap kenaikan dua hitungan berikut:
- `events − pending − poison`: batas bawah event yang terkirim.
- `retries`: batas bawah kegagalan publish yang dicatat outbox.

Hitungan dimulai dari nol. Itu hanya benar karena supervisor kandidat menolak mulai jika database tidak kosong (`assertEmptyHostedApplication` dan `assertClean` sebelum workload). Setelah itu penurunan karena cleanup fixture tidak dikurangkan, jadi dengan syarat awal kosong itu kedua angka tidak pernah dilebihkan. Keduanya juga bisa kurang, karena sampel diambil setiap 3 detik. Contohnya: event terkirim lalu terhapus di antara dua sampel, atau baris yang dibuat, gagal dipublish, lalu dihapus cleanup fixture sebelum sampel berikutnya. Kegagalan seperti itu tidak terlihat di sisi DB. Jadi cek ini menangkap kehilangan diagnostik yang sistematis (seperti T1), bukan setiap baris yang hilang. Penerbit tak teramati yang hanya gagal pada baris berumur pendek masih bisa lolos.

Kode masalah:
- `marked_below_dispatched`, `http_ok_below_dispatched`: outcome `marked` atau jumlah HTTP 2xx dari diagnostik lebih kecil dari batas bawah event terkirim. Artinya ada penerbit yang outputnya tidak teramati, sehingga syarat nol kegagalan transport tidak bermakna.
- `failures_below_db_retries`: jumlah `retry_scheduled` + `permanent_rejection` lebih kecil dari batas bawah `retries`. Artinya ada kegagalan yang tercatat di DB tetapi tidak terlihat. Percobaan `deferred` tidak mengirim request dan tidak menulis ke DB, jadi tidak dihitung di kedua sisi.
- `db_samples_missing`, `transport_missing`: tidak ada sampel DB atau laporan transport, dan workload juga tidak lulus.

Monitor kandidat membaca keadaan DB setiap 3 detik untuk Gate A, B dan C, jadi sampel tersedia di semua gate. Ringkasan job mencetak `dispatched in db >= N, marked M, http 2xx K; failures recorded in db >= R, observed F`.

Batas: relay tidak dapat membedakan reporter dari kode lain di proses Playwright yang sama yang sengaja mencetak event valid. `exit` juga bukan EOF, sehingga penguatan Gate B (EOF per stream, bukti pembunuhan yang disengaja) tetap pekerjaan terpisah dan mode `full` tetap ditolak.

### Mode `full` tidak diadmisi

`authorize` menolak `DISPATCH_MODE=full` dengan `FULL_MODE_NOT_ADMITTED` setelah konsen lain valid. Langkah ini berjalan di job `verify` (tanpa kredensial dan environment staging) dan job staging bergantung padanya, sehingga penolakan terjadi sebelum langkah staging mana pun (test statis menjaga urutan itu). Konstanta `FULL_MODE_ADMITTED` bernilai false. Alasan: batas deklarasi `full` melampaui ceiling job 120 menit; Gate C tidak punya cakupan terikat sumber per browser (reporter tidak menerima daftar judul untuk `full` sehingga kasus berindeks -1 dan ledger memuat 24 kasus untuk 39); dan bukti Gate B belum direview ulang. Mengangkat penolakan memerlukan perubahan terpisah yang direview independen: misalnya sesi terpisah per browser dengan identitas browser dan kasus terikat sumber serta cleanup dan lease per sesi.

### Timing publikasi aplikasi pertama setelah W3

Adapter mengamati baris `[CINEMATCH_REALTIME_ATTEMPT]` pertama dari child workload mana pun dan memancarkan `CINE026_PUBLISH_FIRST` satu kali, hanya berisi enumerasi dan integer terbatas: `kind` (`http` atau `transport`), `via` (`worker` jika baris datang dari worker, `workload` jika dari proses Playwright dan server aplikasinya), `status`, dan `ms` durasi percobaan yang dilaporkan aplikasi sendiri. Supervisor luar mencap waktu kedatangannya dengan jam sendiri dan mencatat `observedAfterWorkloadStartMs` serta `observedAfterW3Ms` (dari akhir permintaan W3: `startedAt + ms` pada evidence warm-up). Label `basis: "supervisor_arrival"` berarti ini waktu observasi lokal. Ini batas atas waktu percobaan itu selesai, bukan waktu jaringan atau provider; durasi percobaan datang dari `attemptMs`. Jika W3 tidak diketahui atau nilai negatif, `observedAfterW3Ms` bernilai null, bukan angka palsu. Percobaan pertama bisa berasal dari worker, bukan jalur cepat aplikasi; `via` menunjukkan mana yang teramati. Ini tidak membuktikan publikasi pertama kasus mana pun, hanya yang pertama yang terlihat pada workload itu.

### Batas atribusi dan asumsi kebijakan

- Selisih jumlah votes adalah agregat seluruh staging yang teramati oleh monitor, bukan bukti penyelesaian putaran per room; selama satu room aktif per waktu, ia sekadar konsisten dengan progres putaran.
- `continuousPendingMs` adalah kehadiran baris pending yang terambil sampel setiap 3 detik. Ia dapat menggabungkan event berbeda dan bukan latensi satu event.
- Ambang diam 150 detik dan batas 120 detik setelah `run_end` adalah asumsi kebijakan saya (tunggu diam terpanjang yang dideklarasikan 100 detik ditambah 50%, dan jeda teardown), bukan ambang yang diukur. Timeout tetap HOLD; klasifikasi hanya atribusi dan dibedakan dari timeout yang sebenarnya.
- Progres yang dibawa reporter adalah penghitung dan durasi, bukan bukti penyelesaian putaran individual.

### Investigasi 64 lock timeout dan pending 10,28 detik (hipotesis, bukan kesimpulan)

Observasi dari artefak dan log provider run 45328006067 (dibaca agen ini; sumber `postgres_logs`):

- Hitungan lock timeout aplikasi (Chromium 22, Firefox 7, WebKit 64, total 93) sepadan dengan 95 baris `canceling statement due to lock timeout` di `postgres_logs` pada jendela yang sama. Kategori ini berasal dari `SET LOCAL lock_timeout = '250ms'` pada `pg_advisory_xact_lock` per room di `postgresOutbox.ts`. Itu menandai kontensi antar-pengirim outbox untuk room yang sama (jalur cepat setelah commit pada dua permintaan vote bersamaan, dan worker yang polling tiap 1000 ms). Baris tetap pending untuk percobaan berikutnya; `retry_scheduled` dan `retries` tetap 0 dan tidak ada kegagalan provider.
- `postgres_logs` juga memuat belasan `process N acquired ShareLock on transaction ... after ~4.3 s` (4,0 sampai 4,4 detik, berulang) dan beberapa `after ~1,3 s`. Itu menandai satu transaksi menunggu transaksi lain selama sekitar 4,3 detik, pola yang konsisten dengan dua permintaan vote bersamaan yang saling menunggu `SELECT ... FOR UPDATE` pada baris room.

Hipotesis H1, pending 10,28 detik sebagian besar adalah artefak ukur. Dari sumber (`postgresRoomRepository.ts`, jalur vote): `recordVoteCoreWithClient` mengambil `nowIso = this.now().toISOString()` di awal operasi, sebelum `SELECT ... FOR UPDATE` pada baris room, lalu menyimpannya sebagai `created_at` event `VOTE_RECORDED` (bukan `DEFAULT NOW()` saat commit). Jalur room-created, join, reconnect dan host-transfer memakai pola yang sama. Maka `oldest_pending_ms = clock_timestamp() - min(created_at)` mencakup waktu menunggu lock baris, antre pool, dan round trip sebelum event terlihat. Dukungan tambahan: pola tunggu 4,3 detik dan nilai puncak serupa pada ketiga browser (7,3 / 9,3 / 10,3 detik). Belum terbukti: besar kontribusi setiap bagian, karena tidak ada pengukuran langsung dari commit ke dispatch dan jalur lain tidak dibaca semuanya.

Hipotesis H2, latensi per permintaan didominasi round trip database melalui pooler dari runner ke project staging: tiap transaksi vote memuat banyak statement sehingga lock baris dipegang beberapa detik. Dukungan: tunggu 4,3 detik berulang. Belum terbukti: round trip tidak diukur sebelum ini.

Alat ukur yang ditambahkan, tanpa sesi atau statement baru: (1) `continuousPendingMs`, lama pending terus-menerus yang diamati sejak sampel pertama dengan pending lebih dari nol (tidak bergantung pada `created_at`); (2) waktu round trip `readState` per sampel (`rttMs`) sebagai proksi latensi pooler; (3) kenaikan votes per kasus. Membandingkan `oldestPendingMs` dengan `continuousPendingMs` pada dispatch berikutnya menguji H1; `rttMs` menguji H2. Tidak diusulkan dispatch instrumentasi tersendiri: Gate A-only berikutnya sudah menghasilkan semuanya.

Reproduksi offline (tanpa staging): `workload-progress.test.cjs` memodelkan timeline tiga kasus WebKit dengan laju sekitar 21 detik per putaran exhaustion. Anggaran lama 420 detik menghentikan run saat kasus exhaustion masih `CASE_ACTIVE_PROGRESSING` pada kurang dari 44 vote, sedangkan anggaran turunan membiarkan timeline yang sama selesai. Model ini memvalidasi interaksi supervisor dan anggaran, bukan laju staging.

Residual terbuka: penyebab WebKit melampaui 420 detik pada run itu (kasus lambat versus teardown) belum terbukti; progres per kasus pada dispatch berikutnya akan menunjukkannya. Sebab-akibat hint ke GET dan cold-path recovery tetap terbuka. Perubahan ini tidak mengubah kandidat, pin, deadline 1500 ms, retry, DB pool, atau gate nol kegagalan transport.
