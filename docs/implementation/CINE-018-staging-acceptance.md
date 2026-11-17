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
still required before hosted mutations.

### Narrow reconciliation and rollback plan

Before writes: obtain current project Realtime/Auth configuration without publishing
secret values, snapshot it privately, finish inventory/backup coverage, and recheck
that the identified application namespace remains empty and unchanged. If unknown
data or ownership appears, stop affected mutations and publish the discrepancy.

The planned reconciliation preserves the historical001 row as evidence of drift;
apply canonical001–005, in order under explicit public search_path, within a controlled
transaction after emptiness checks. Record the repair and canonical source hashes in
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

## Current gate

Hosted configuration snapshot, canonical setup and hosted WS/recovery/latency
qualification remain BLOCKED/NOT RUN pending authenticated configuration/secret
access. The available connector exposes SQL and publishable keys, but not the
Realtime configuration or server/JWT secrets. The dashboard browser currently asks
for sign-in. Do not use database privileges to extract managed service secrets.

Keep staging intact through acceptance. Future release cleansing is a separate
owner-gated inventory, backup, provenance-scoped deletion, verification and rollback
operation. No production deployment, merge, self-approval or CINE-019/021 work.
