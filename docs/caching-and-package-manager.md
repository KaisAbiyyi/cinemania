# Package Manager Standardization & CI Cache Guidance

- **Task Reference:** CINE-003 · Standardize package manager and reproducibility
- **Canonical Issue:** [GitHub Issue #5](https://github.com/KaisAbiyyi/cinemania/issues/5)
- **Status:** Standardized on `npm` with canonical `package-lock.json` (lockfileVersion 3)

---

## 1. Package Manager Standardization

### 1.1 Decision & Authority
- **Canonical Package Manager:** `npm` (v10+; verified on npm 11.19.0).
- **Canonical Runtime:** Node.js `24.x` (verified on local Node v24.21.0 and Vercel build container).
- **Runtime Specification:**
  - Root `.nvmrc` pins `24` (replaces EOL Node 20).
  - Root `package.json` specifies `"engines": { "node": "24.x", "npm": ">=10.0.0" }`.
    - *Vercel Pinning Note:* Using exact major `"24.x"` prevents Vercel build containers from automatically defaulting to unrequested majors (such as Node 26.x) and guarantees consistent runtime behavior across local workstations, GitHub Actions, and Vercel.
- **Single Canonical Lockfile:** `package-lock.json` (v3). `bun.lock` is permanently removed to eliminate divergence and prevent dual-package-manager drift.

### 1.2 Divergence Root Cause & Resolution
- **Baseline Product Defect (CINE-001 Finding):**
  - Historical commits in 2025 introduced packages via Bun, updating `bun.lock` while leaving `package-lock.json` unmaintained since March 2025.
  - Bun's default resolver silently bypassed npm peer dependency contracts. When running standard `npm ci`, npm failed with `ERESOLVE`:
    1. `cmdk@1.0.0` declared peer dependency `react@"^18.0.0"`, conflicting with project root `react@"^19.0.0"`.
    2. `react-day-picker@8.10.1` declared peer dependencies `react@"^16.8.0 || ^17.0.0 || ^18.0.0"` and `date-fns@"^2.28.0 || ^3.0.0"`, conflicting with project root `react@"^19.0.0"` and `date-fns@"^4.1.0"`.
- **CINE-003 Clean Resolution & CINE-002 Alignment:**
  - Integrated directly with CINE-002 Next.js 16.4.5 modernization and DayPicker v9 canonical class mappings (`8d98612`).
  - Upgraded `cmdk` to `^1.1.1` (official release with full React 19 peer support).
  - Upgraded `react-day-picker` to `^9.14.0` (DayPicker v9 has no peer dependency on `date-fns`, completely eliminating peer conflicts with `date-fns@^4.1.0` and removing the need for npm `overrides`).
  - Adapted `src/components/ui/calendar.tsx` to DayPicker v9's component API (`Chevron` component and v9 class names).
  - Removed deprecated `bun.lock`.
  - Zero npm `overrides` or `--legacy-peer-deps` required.
  - `npm ci` installs deterministically with exit code 0.

---

## 2. Developer Workflow & Deterministic Commands

### 2.1 Clean Machine / CI Installation
Always use `npm ci` for deterministic, clean installs matching `package-lock.json`:
```bash
# Recommended clean install command
npm ci
```

### 2.2 Adding or Updating Dependencies
When adding or updating packages:
```bash
# Install new dependency
npm install <package-name>

# Install new development dependency
npm install -D <package-name>
```
Always commit both `package.json` and the updated `package-lock.json` in the same commit. Never commit without the lockfile.

---

## 3. CI Caching Architecture (GitHub Actions & Vercel)

### 3.1 GitHub Actions Workflow Guidance
For CI pipelines (e.g. CINE-004), configure npm package cache and Next.js build cache as follows:

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc' # Resolves to Node 24
          cache: 'npm' # Automatically caches ~/.npm directory based on package-lock.json

      - name: Cache Next.js build artifacts
        uses: actions/cache@v4
        with:
          path: |
            ${{ github.workspace }}/.next/cache
          key: ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}-${{ hashFiles('src/**/*.{js,jsx,ts,tsx}') }}
          restore-keys: |
            ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}-

      - name: Install dependencies (clean reproducible)
        run: npm ci

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint

      - name: Production Build
        run: npm run build
```

### 3.2 Vercel Deployment Optimization & Cloud Parity
- **Framework & Build Commands:**
  - Build Command: `npm run build`
  - Install Command: `npm ci`
- **Configuration as Code (`vercel.json`):**
  - Declares root `installCommand: "npm ci"` and `buildCommand: "npm run build"` to enforce npm clean-install semantics across all cloud environments.
- **Observed Cloud Runtime & Build Parity:**
  - Committed in-repo `vercel.json` guarantees portable build/install configuration without reliance on untracked dashboard UI mutations.
  - Vercel build containers independently execute `Running "install" command: npm ci` and `Running "build" command: npm run build` under Node 24.x LTS (verified in cloud build logs for exact deployment receipts).
- **Node.js Runtime Pinning:**
  - `.nvmrc` and `package.json#engines.node: "24.x"` pin the Vercel build container runtime strictly to Node 24.x LTS.
- **Next.js Cache Persistence:**
  - Vercel automatically preserves `.next/cache` across consecutive builds on the same project branch.
