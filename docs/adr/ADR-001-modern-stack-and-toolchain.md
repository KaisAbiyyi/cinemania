# ADR-001: Modernization to Next.js 16, Canonical npm Toolchain & Node 24 LTS

- **Status:** Accepted
- **Deciders:** CineMatch Architecture Team & Repository Owner
- **Date:** 2026-11-05 (Reified 2026-11-08)
- **Task References:** [CINE-001](https://github.com/KaisAbiyyi/cinemania/issues/3), [CINE-002](https://github.com/KaisAbiyyi/cinemania/issues/4), [CINE-003](https://github.com/KaisAbiyyi/cinemania/issues/5)
- **Pull Requests:** [PR #33](https://github.com/KaisAbiyyi/cinemania/pull/33), [PR #34](https://github.com/KaisAbiyyi/cinemania/pull/34), [PR #35](https://github.com/KaisAbiyyi/cinemania/pull/35), [PR #36](https://github.com/KaisAbiyyi/cinemania/pull/36)

---

## 1. Context and Problem Statement

When the CineMatch project commenced modernization from the legacy CineMania codebase (`a7b93e9`), the initial baseline audit (CINE-001) revealed severe foundational defects:
1. **Security Vulnerabilities in Framework:** The project was running Next.js 15.2.8 on React 19, which suffered from React Server Components CVE vulnerabilities and outdated compiler internals.
2. **Dual-Toolchain Lockfile Desynchronization:** Packages had been partially added via `bun` in early 2025, leaving `bun.lock` committed while `package-lock.json` remained unmaintained (stuck on Next.js 15.2.1 and missing 400+ transitive packages).
3. **Broken Clean Installation (`npm ci` Failure):** Running standard `npm ci` failed deterministically with `ERESOLVE`:
   - `cmdk@1.0.0` declared peer dependency `react@"^18.0.0"` conflicting with root `react@"^19.0.0"`.
   - `react-day-picker@8.10.1` declared peer dependencies conflicting with `react@"^19.0.0"` and `date-fns@"^4.1.0"`.
4. **Runtime Obsolescence:** Node 20 LTS was approaching end-of-life, necessitating alignment with current active LTS (Node 24).
5. **Lack of Automated Testing & Reproducibility:** No CI caching, deterministic install scripts, or reproducibility assertions existed.

---

## 2. Decision Drivers

- **Clean Machine Determinism:** Any contributor or CI environment must be able to clone the repository and run `npm ci` with zero manual intervention, flags, or overrides.
- **Single Toolchain Authority:** Eliminate multi-package-manager drift; one single lockfile format must serve as source of truth.
- **Modern Standards Compliance:** Use the latest stable Next.js 16.x release with Turbopack, React 19, and Node.js 24 LTS.
- **Zero Workarounds:** No `--legacy-peer-deps` or npm `overrides` that mask underlying dependency incompatibilities.
- **Cloud Build Parity:** Vercel deployment builds must execute the exact same clean install command (`npm ci`) as local and CI environments.

---

## 3. Considered Alternatives

- **Alternative 1: Retain Next.js 15.x and patch peer dependencies with npm `overrides`:**
  - *Rejected:* Would not resolve React Server Components CVE concerns or modernize compiler infrastructure to Next 16 Turbopack; overrides create long-term maintenance debt.
- **Alternative 2: Standardize on Bun instead of npm:**
  - *Rejected:* Bun's loose resolver masked peer dependency violations rather than solving them; cloud platforms and CI tooling have universal, native, first-class support for npm v10+.
- **Alternative 3: Use `--legacy-peer-deps` in CI:**
  - *Strictly Rejected:* Violates Section 2 of `AGENTS.md` ("Do not use --force or --legacy-peer-deps to conceal an install failure").

---

## 4. Decision

We agreed on the following unified architectural upgrades:

1. **Framework Modernization:** Upgrade Next.js to `16.4.5` (Turbopack bundler) with official React 19 compatibility.
2. **Canonical Package Manager:** Designate `npm` (v10+; tested on npm 11.19.0) as the sole official package manager.
   - Permanently delete `bun.lock`.
   - Maintain `package-lock.json` (lockfileVersion 3) as the single authoritative lockfile.
3. **Runtime Specification:**
   - Root `.nvmrc` pins Node.js `24`.
   - Root `package.json` specifies `"engines": { "node": "24.x", "npm": ">=10.0.0" }`.
4. **Clean Dependency Reconciliation:**
   - Upgrade `cmdk` to `^1.1.1` (native React 19 peer support).
   - Upgrade `react-day-picker` to `^9.14.0` (eliminates peer dependency on `date-fns`).
   - Adapt `src/components/ui/calendar.tsx` to DayPicker v9 component API.
   - Zero npm `overrides` and zero `--legacy-peer-deps`.
5. **Configuration as Code for Cloud Parity:**
   - Commit root `vercel.json` specifying `installCommand: "npm ci"` and `buildCommand: "npm run build"`.
6. **Linting Configuration Harmonization:**
   - Configure `eslint.config.mjs` flat config to ignore `docs/**` non-application fixtures and scope React hooks rules to source code files (`**/*.{js,jsx,mjs,ts,tsx,mts,cts}`).

---

## 5. Consequences

### Positive
- `npm ci` completes with Exit Code 0 in ~1-2 minutes across local machines, GitHub Actions, and Vercel cloud builders.
- Typecheck (`npx tsc --noEmit`) passes with 0 errors across all 29 UI pages and 27 API route handlers.
- Linting (`npm run lint`) executes cleanly with 0 errors.
- Next.js Turbopack build (`npm run build`) compiles in ~18 seconds and statically prerenders 24 routes.
- Zero peer dependency warnings or resolution conflicts.

### Negative / Tradeoffs
- npm audit discloses 17 transitive vulnerabilities (2 low, 9 moderate, 6 high; 2 high in production dependencies `source-map-js` and `zod`). In accordance with governance, a **Product Release Hold** is retained until a dedicated security remediation task addresses upstream patches.
