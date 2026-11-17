# CINE-018 staging continuation — epoch 4

The owner designated existing project `dmrbticnsczhyaiftrar` (CineMatch,
ap-northeast-2, PostgreSQL 17) as staging on 2026-11-17:
[authorization](https://github.com/KaisAbiyyi/cinemania/issues/20#issuecomment-6947995866).
No new project or paid branch is required. This supersedes the earlier permission
blocker, without waiving hosted qualification, independent review or owner acceptance.
[Claim](https://github.com/KaisAbiyyi/cinemania/issues/20#issuecomment-6948354327).

## Read-only baseline and migration disposition

Observed against inherited source `6741fa84e38d25516d3d4d375bd4bd8625bb271d`:

- Project ACTIVE_HEALTHY, PostgreSQL 17.11.0.018; strict-TLS direct SQL connection succeeded.
- Catalog inventory includes all non-system schemas/relations, public function/type
  definitions, all policies, default ACLs, application/Realtime table grants,
  extension versions and complete migration records.
- Public relations, public types and public functions: **0 each**. Application
  policies in public/realtime: **0**. Auth users, storage buckets, storage objects,
  realtime messages: **0 each**. These counts do not imply all managed schemas are empty.
- History contains exactly `20261112011644 / 001_create_room_schema`. Its stored
  statement matches canonical `src/db/migrations/001_create_room_schema.sql` after
  CRLF/LF normalization and trimming. History is inconsistent with the actual catalog;
  it is not a successful current-schema qualification. Cause is **NOT VERIFIED**.
- Existing public schema owner is `pg_database_owner`; its ACL includes
  `cinematch_runner` CREATE/USAGE. Supabase default ACLs grant broad defaults;
  canonical migrations' explicit revokes must be verified after installation.
  No existing role, default ACL, schema owner or managed object was changed.

Private backup files are outside the repository in the epoch4 evidence directory.
Never publish their contents: full database exports can contain managed credentials
or private configuration even when application tables are absent.

| Backup | SHA-256 | Verification |
| --- | --- | --- |
| Full custom archive | `9d1a089e9e89311694d84996b9823489629ae726ec879a6792c7ef80e0e88296` | pg_dump18 exit0; pg_restore18 lists594 TOC entries |
| Full schema SQL | `fb7fcb426ac1e78488c0421edf14b95bde840b839cb9e82a8ad77b7af7d99f07` | pg_dump18 schema-only exit0 |
| public + supabase_migrations archive | `e34354754f1a8665a6c8c94fcb120122bfea4b93c853ec8f80bdb3b828ac6518` | Restored to exclusively created local template0 database; migration rows deep-equal baseline; public relations0; owned restore DB removed |

The application restore used `--no-owner --no-acl` to accommodate local managed-role
differences. Original owners/grants remain in the backup and catalog inventory.
This proves application/history content recovery, **not** a full managed-platform,
role/ACL, Auth, Storage or Realtime configuration restore. Full archive readability
does not prove full-platform restore. A verified project configuration snapshot is
was captured before hosted mutations (see configuration disposition below).

### Narrow reconciliation and rollback plan

Before writes: obtain current project Realtime/Auth configuration without publishing
secret values, snapshot it privately, finish inventory/backup coverage, and recheck
that the identified application namespace remains empty and unchanged. If unknown
data or ownership appears, stop affected mutations and publish the discrepancy.

The reconciliation preserves the historical001 row as evidence of drift;
apply canonical001–005, in order under explicit public search_path, through managed
transactional migrations after emptiness checks. Record the repair and canonical source hashes in
new migration history rather than silently asserting the old row reflects current
objects. Do not drop public, reset the linked project, overwrite managed objects,
rotate secrets, or change unrelated grants. Compare installed definitions, indexes,
constraints, functions, RLS and effective grants to a canonical disposable restore.

On SQL failure, transaction rollback preserves the baseline. After successful setup,
prefer a forward correction; any rollback must first stop the two test apps/workers,
inventory newly created objects and fixture provenance, and take a fresh backup.
Remove only epoch4-owned synthetic records/objects with verified dependencies;
never run all down migrations against unidentified contents. Restore the preserved
migration history and exact prior project setting only within the same scoped
change, then recheck baseline/catalog/grants. Escalate uncertain dependencies.

## Runtime packaging and operations

`pg` and `tsx` are runtime dependencies. Ship the pinned source tree, package.json,
package-lock.json, tsconfig.json, scripts/realtime-worker.ts and its imported src
modules; install with `npm ci --omit=dev` on Node24. A Next standalone artifact alone
does not contain this worker source/runtime contract. Do not copy a development
node_modules tree or assume devDependencies exist.

The production command is:

```sh
node --import tsx --conditions=react-server scripts/realtime-worker.ts
```

Supply server-only PG credentials (strict TLS and the bundled Supabase root CA),
SUPABASE_URL, SUPABASE_SECRET_KEY and validated optional polling/schema settings
through the host's secret environment mechanism. The worker never loads .env files.
Do not use .env.test.local or its historical consent flag for production/hosted tests.
Keep the PG app authority and dispatcher on the same canonical schema. HTTP requests
remain an optional low-latency fast path; the persistent worker supplies autonomous
no-traffic recovery. Run the worker on a host supporting continuously running Node
processes, not a Next serverless request timer.

Example Linux supervision contract (configuration example only, not installed):

```ini
[Service]
Type=simple
User=cinematch
WorkingDirectory=/srv/cinematch/current
Environment=NODE_ENV=production
EnvironmentFile=/etc/cinematch/worker.env
ExecStart=/usr/bin/node --import tsx --conditions=react-server scripts/realtime-worker.ts
Restart=always
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
```

Restrict the environment file to the service owner. SIGTERM drains the active sweep
and closes the pool; forced kill can duplicate a hint after publish-before-ack and
is recovered by durable retry/deduplication. Multiple workers coordinate with the
same per-room advisory transaction lock. Alert on restart loops, repeated generic
sweep-failure logs, poison rows and increasing oldest pending-event age. A running
PID/startup ready line alone does not prove publication liveness; use an owned
synthetic canary with observed WS receipt + durable acknowledgement, plus pending
age/poison monitoring. No health endpoint or deployed supervisor is claimed here.

`tests/local-supabase/worker-production-install.cjs` archives exact HEAD, performs
a clean production-only install, checks development test runtime absent, then boots
the real CLI against an exclusively created empty local schema for idle sweeps.
Its unused synthetic hosted publisher configuration does not exercise hosted transport.
The existing local/hosted acceptance harness supplies the separate recovery evidence.

## Hosted configuration and canonical setup

Owner completed dashboard sign-in after the initial access checkpoint. Existing API
and legacy JWT credentials were stored only in an owner/SYSTEM-readable local file;
no key was created or rotated. Current managed JWT key is ECC P-256; the previous
HS256 key remains enabled for verification. Hosted acceptance must actually prove
the application's signed HS256 guest tokens are accepted; this configuration is not
assumed from the key listing.

Before changes: Realtime enabled, Allow public access ON, authorization/changes pools
2/2, maxclients200, events100/s, presence20/s, payload256KB. Data API enabled, two
schemas exposed, automatic table exposure ON, extra search_path public/extensions,
maxrows1000. Private UI/config snapshots are in the protected backup directory.
Only Realtime Allow public access was changed OFF, with saved OFF state observed.
No other API/Auth limit or configuration was changed.

Managed history now preserves original `20261112011644`, plus restore001 at
`20261117131107`,002 at `20261117131126`,003 at `20261117131152`,004 at
`20261117131215`,005 at `20261117131224`. This identifies actual reconciliation
rather than rewriting the original drift record. No down migration or reset ran.

The first hosted security advisor/query found Supabase's explicit default anon
EXECUTE grant survived 001's PUBLIC-only revoke on the membership helper. CINE-018
migration005 now explicitly revokes it and client RPC access to trigger callbacks,
and pins the immutable-update callback's search_path. The same narrow repair was
recorded in a separate hosted migration after initial setup. Authenticated helper
EXECUTE is intentional: its SECURITY DEFINER lookup derives sub from signed JWT,
returns only membership boolean, and does not enumerate the roster. Denied tables
with RLS and no client policies are intentional server-only state.
The catalog comparison additionally detected inherited service_role UPDATE on the
outbox sequence, whereas canonical001 intends USAGE/SELECT. A second narrow repair
revokes UPDATE explicitly in005 and in a recorded hosted repair migration. Neither
repair modifies unrelated default ACLs or managed roles. These are the two bounded
ACL remediation changes; further product failures require escalation under the
owner's two-iteration limit. Harness-only diagnostics/deparser corrections are
recorded separately from product failures.

`tests/hosted-supabase/environment.cjs` accepts only project
`dmrbticnsczhyaiftrar`, its exact HTTPS origin and direct/session PG port5432 with
strict TLS. A fresh invocation must supply `CINE018_STAGING_PROJECT` matching the
owner-designated project. Credential files cannot supply consent, NODE_OPTIONS,
destructive flags or arbitrary runtime options. Eight synthetic safety cases cover
those boundaries. Legacy CINE-012 consent remains false throughout.

Existing WS/RLS, two-instance and outbox harnesses have an explicit `--hosted-staging`
mode using that fence; default mode retains GH-52 local-only checks. Hosted room
tests refuse pre-existing rooms. Competing policies use random names and cleanup
ownership is acquired only after CREATE succeeds; fixtures are tracked by returned
UUID and expired before deletion. The outbox fault suite exclusively creates its
own random temporary schema and never loads application migrations there.
`schema-consistency.cjs` compares installed columns, constraints, indexes, functions,
policies, RLS, triggers and effective role grants to exact-HEAD migrations applied
in a disposable LOCAL database. Source/history/owner differences remain disclosed.

Final exact-HEAD receipt is the authority for PASS/FAIL/NOT RUN, including any
first-attempt failure. Initial hosted WS attempt returned CHANNEL_ERROR while service
logs showed partition initialization; causality was not proved. A later actual
private-WS/JWT/RLS/forgery/anonymous suite passed on the working candidate. This is
not yet final exact-HEAD qualification. Hosted two-instance/recovery/latency evidence
must be published separately; no local result is substituted.

Keep staging intact through acceptance. Future release cleansing is a separate
owner-gated inventory, backup, provenance-scoped deletion, verification and rollback
operation. No production deployment, merge, self-approval or CINE-019/021 work.
