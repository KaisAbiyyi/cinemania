# CineMatch Local Supabase Development Infrastructure (Windows-First)

This guide covers the **local-only** Docker + Supabase infrastructure for CineMatch (`GH-52`).

> **Scope & Safety Boundary:**
> Local Docker qualification tests real PostgreSQL 17.6 + Supabase Realtime private WebSockets on loopback (`127.0.0.1`) only. It **does not** mutate any hosted Supabase project, perform linked resets, deploy to production, or replace CINE-018's separate hosted cloud acceptance gate.

---

## 1. Prerequisites (Windows 11 / PowerShell)

1. **Node.js 24 LTS & npm 10+**:
   ```powershell
   node -v   # v24.x
   npm -v    # >= 10.x
   ```
2. **Docker Desktop with WSL 2 Linux Engine**:
   Verify that the Linux container engine (`desktop-linux`) and WSL 2 distro are actively running before starting the stack:
   ```powershell
   docker version
   docker info --format "{{.OSType}} {{.ServerVersion}}"
   wsl --status
   wsl --list --verbose
   ```
   If `docker version` fails to connect to the server daemon, start **Docker Desktop**, ensure **Use the WSL 2 based engine** is enabled in Settings -> General, and wait until `docker info` succeeds.
3. **Install Dependencies**:
   ```powershell
   npm ci
   npm --prefix scripts/local-supabase ci
   ```
   The Supabase CLI is pinned at **`3.2.0`** in `scripts/local-supabase/package.json` and `scripts/local-supabase/package-lock.json` (plus `supabase/config.toml` and `supabase/supabase.lock`). Verify the pinned CLI:
   ```powershell
   npx --prefix scripts/local-supabase --no-install supabase --version
   ```

---

## 2. Architecture & Security Invariants

- **Loopback-Only Exposure:**
  - Compose project name: `cinematch-gh52d` (`scripts/local-supabase/compose.yml`)
  - Local PostgreSQL 17.6 (`db`): `127.0.0.1:55432` -> container `5432`
  - Local Nginx Gateway (`gateway`): `127.0.0.1:54321` -> container `8000` (proxies `/realtime/v1/api/` and WebSocket `/realtime/v1/` to Supabase Realtime; blocks `/realtime/v1/api/tenants` and `/realtime/v1/api/openapi` with HTTP `403`)
  - `scripts/local-supabase/runtime.cjs` and `safety.cjs` assert both Docker container port bindings AND live Windows TCP listeners (`Get-NetTCPConnection`) are bound strictly to `127.0.0.1` / `::1` and refuse execution if `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, or non-loopback `DATABASE_URL` / `SUPABASE_URL` are present.
- **Private-Only Realtime:**
  The `realtime` service entrypoint seeds the local tenant and enforces `_realtime.tenants.private_only = true` before starting `/app/bin/server`, ensuring public channels remain disabled across every restart and reset.
- **Single Source of Truth Migrations (`001`–`005`):**
  There is **no** duplicated `supabase/migrations/` directory. `scripts/local-supabase/apply-migrations.cjs` reads `src/db/migrations/001..005` directly from an explicit 40-character lowercase Git commit SHA (e.g., PR #51 HEAD `d82fa1629b7afa89c61badfe1ed9c4163eea22ab` while `005` is on PR #51, or merged `HEAD` once landed).
- **Synthetic Credentials Only:**
  `scripts/local-supabase/generate-env.cjs` generates fresh random local credentials into gitignored `supabase/.env.local` and optional loopback Next.js configuration into gitignored `supabase/.env.app.local`. See `scripts/local-supabase/.env.local.example` for variable names.

---

## 3. Lifecycle Commands (Start, Stop, Reset, Seed, Health)

Use either `node scripts/local-supabase/ctl.cjs` or the Windows PowerShell wrapper `scripts/local-supabase/local-supabase.ps1`:

### Fresh Reset + Canonical Migrations 001–005 + Synthetic Seed
```powershell
.\scripts\local-supabase\local-supabase.ps1 reset -Yes -Commit d82fa1629b7afa89c61badfe1ed9c4163eea22ab -Seed
```
Or with Node:
```powershell
node scripts/local-supabase/ctl.cjs reset --yes --commit d82fa1629b7afa89c61badfe1ed9c4163eea22ab --seed
```

### Start / Stop / Health Check / Synthetic Seed
```powershell
# Start stack (preserves existing local DB volume)
.\scripts\local-supabase\local-supabase.ps1 start

# Run full health check (Docker containers, loopback ports, private_only, 001-005 tables & RLS policies, 403 blocks)
.\scripts\local-supabase\local-supabase.ps1 health

# Apply synthetic seed data (idempotent: rooms GH52A2 in LOBBY, GH52B3 ACTIVE with 20 synthetic candidates)
.\scripts\local-supabase\local-supabase.ps1 seed

# Stop stack cleanly (preserves DB volume)
.\scripts\local-supabase\local-supabase.ps1 stop
```

---

## 4. Loopback Next.js Integration (Using PR #51 `d82fa162`)

PR #51 (`d82fa162`) updated `src/lib/server/realtime/supabasePublisher.ts` to allow `http://127.0.0.1:<port>` or `http://localhost:<port>` **only** when:
- `CINEMATCH_ALLOW_LOCAL_REALTIME=true`, AND
- `NODE_ENV=development` or `NODE_ENV=test` (never `NODE_ENV=production`).

> **Note:** Next.js `next build` + `next start` constant-folds `process.env.NODE_ENV` to `"production"`, which disables local HTTP loopback by design. Run local loopback Next.js servers with `npm run dev` (`NODE_ENV=development`) or Vitest/tsx (`NODE_ENV=test`).

`node scripts/local-supabase/generate-env.cjs --app-env` writes a complete loopback env file to `supabase/.env.app.local` (gitignored) without printing secrets.

---

## 5. Local Qualification Suites

```powershell
# 1. Unit & safety guard checks (does not require running Docker)
npm --prefix scripts/local-supabase run test:guards

# 2. Canonical 001-005 up -> down -> up in a NEW disposable database
node tests/local-supabase/migration-roundtrip.cjs --commit d82fa1629b7afa89c61badfe1ed9c4163eea22ab
node tests/local-supabase/migration-isolation-qualification.cjs

# 3. Real private Realtime WebSocket, JWT/RLS, cross-room & competing-policy forgery denial
npm --prefix scripts/local-supabase run test:rls-ws

# 4. Two Next.js instances, reconnect, request-assisted crash/restart recovery, latency
npm --prefix scripts/local-supabase run test:two-instances
```

### Migration roundtrip safety

The rollback destroys CineMatch tables and rows **inside a fresh disposable database only**.
Each run exclusively creates `cinematch_roundtrip_<random UUID hex>` from `template0` in
the verified local Compose PostgreSQL container. It never runs migrations against the
development `postgres` database, clones developer data, or accepts a database/volume target.
Only minimal synthetic `auth.jwt()` / `realtime.messages` prerequisites are created;
this migration test does not prove real Realtime authorization (run suite 3 for that).

Existing developer rooms, participants, votes, events and credentials are preserved.
The roundtrip compares a hash of the development public schema, rows and sequence state
before and after; it reports only hashes, never the underlying developer content.
The old `--reseed` option and all options except `--commit` fail before Docker is called.
No destructive confirmation is needed because there is no shared-database execution path.
Create collisions fail without running work or dropping the existing database. Cleanup
drops only the database successfully created by this invocation, including after migration
failure; it never forces active connections closed. A killed process or failed cleanup can
leave an isolated test database behind: inspect it before manually removing that exact
database. Never reset the development volume to clean up a failed roundtrip.

### Recovery evidence boundary

The two-instance test simulates a committed stranded outbox row, restarts the process,
then sends an authorized `GET /api/rooms/<id>/events?since=5` that triggers pending dispatch.
Its result is **request-assisted crash/restart recovery**, not autonomous no-traffic
dispatcher recovery. The latter is NOT RUN here and remains CINE-018's separate unresolved
dispatcher gate; its mandatory hosted qualification is unchanged.
