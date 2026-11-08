# CINE-002 — Pre/Post Upgrade HTTP Responses & Visual Regression Report (Revision 7)

- **Task Reference:** CINE-002 · Upgrade to latest stable Next.js 16.x
- **Issue Reference:** [GitHub Issue #4](https://github.com/KaisAbiyyi/cinemania/issues/4)
- **PR Reference:** [GitHub PR #36](https://github.com/KaisAbiyyi/cinemania/pull/36)
- **Product Merge SHA:** `a03cff36b3ce287c3932a27bf500099a732a2d94` (PR #35)

---

## 1. Executive Summary & Architectural Modernization

| Dimension | Pre-Upgrade Baseline (Next.js 15.2.8 / Commit `9df1fa1`) | Post-Upgrade Modernization (Next.js 16.4.5 / Commit `a03cff3`) | Architectural Variance & Compliance Notes |
| :--- | :--- | :--- | :--- |
| **Framework Version** | `next@15.2.8`, `eslint-config-next@15.2.1` | `next@16.4.5`, `eslint-config-next@16.4.5` | Upgraded to latest stable Next.js 16.x release without Canary packages. |
| **Compiler / Bundler** | Webpack / experimental Turbopack | Turbopack (Default in Next.js 16) | Next.js 16 Turbopack production compilation: 1.2s on Vercel / 2.0s local. |
| **Node Engine** | Unspecified / Unpinned (`>=20.9.0`) | Strictly Pinned: `engines.node: "24.x"`, `.nvmrc: 24` | Aligned local Windows toolchain (`v24.21.0`) with Vercel Cloud deployment (`Node 24.x`). |
| **Reproducible Install** | **FAIL** (`npm ci` exit code 1 / ERESOLVE: `cmdk@1.0.0` vs React 19) | **PASS** (`npm ci` exit code 0: 432 packages cleanly added) | Clean resolution via `cmdk@^1.1.1` and `react-day-picker@^9.14.0`. |
| **Linting System** | ESLint 9 + `@eslint/eslintrc` `FlatCompat` | Native ESLint 9 Flat Config (`core-web-vitals` + `typescript`) | Native flat config exports from `eslint-config-next@16.4.5`; script modernized to `eslint .`. |
| **TypeScript Config** | `jsx: preserve`, `.next/types/**/*.ts` | `jsx: react-jsx`, `.next/dev/types/**/*.ts` | Automatic Next.js 16 compiler alignment. |
| **Image Optimization** | Deprecated `images.domains` | Modern `images.remotePatterns` | Protected against arbitrary remote origins (`image.tmdb.org`, `img.youtube.com`). |
| **Component Compatibility** | DayPicker v8 legacy slots (`IconLeft`, `IconRight`) | DayPicker v9 `Chevron` adapter + canonical v9 classNames | Canonical v9 elements supported alongside v8 aliases for full backward compatibility. |

---

## 2. HTTP Responses & Response-Body Parity Analysis

### 2.1 Baseline Accessibility & Acceptance Status
In accordance with repository governance (`AGENTS.md` Sections 1 & 2):
1. **Local Baseline Environment:** Local reproduction of the baseline Next.js 15.2.8 build from commit `9df1fa1` is **BLOCKED** because `npm ci` fails deterministically with `ERESOLVE` (`cmdk@1.0.0` requires peer `react@"^18.0.0"` while root specifies `react@"^19.0.0"`). Concealing this failure via `--force` or `--legacy-peer-deps` is strictly prohibited by repository governance.
2. **Cloud Baseline Environment:** The pre-upgrade Vercel preview deployment (`https://cinemania-khg953yjo-kaisabiyyis-projects.vercel.app`, deployment `dpl_DaCCoFNJM9yZ8B9yG1rGMk9xZNCr`) is protected by Vercel SSO / Deployment Protection, returning `HTTP/1.1 302 Found` with redirect location `https://vercel.com/sso-api?url=...` when accessed without session tokens.
3. **Acceptance Gate Disposition:** Because legitimate side-by-side execution of Next 15 baseline cannot be reproduced without violating peer-dependency constraints, the strict baseline-vs-Next16 pre/post visual and payload differential remains **BLOCKED / NOT VERIFIED** pending explicit owner waiver. Below, we verify post-upgrade Next.js 16 runtime behavior under the deterministic mock fixture.

### 2.2 Post-Upgrade Endpoint & Payload Verification Matrix
All endpoints were verified against the running Next.js 16.4.5 server (`http://localhost:3055`) with the committed deterministic TMDB mock interceptor (`docs/artifacts/cine-002/fixtures/mock_tmdb.cjs`).

| Route | HTTP Method | Status | Content-Type | Key Headers | Response Body Summary / Payload Contract | Verdict |
| :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| `/` | `GET` | `200 OK` | `text/html; charset=utf-8` | `Vary: rsc, next-router-state-tree...`<br>`Cache-Control: private, no-cache, no-store` | Next.js 16 App Router root page HTML with embedded flight manifests. | **PASS** |
| `/movie` | `GET` | `200 OK` | `text/html; charset=utf-8` | `X-Nextjs-Prerender: 1`<br>`Content-Length: 36754` | Prerendered static movie discovery shell with filter sidebar. | **PASS** |
| `/tv` | `GET` | `200 OK` | `text/html; charset=utf-8` | `X-Nextjs-Prerender: 1`<br>`Content-Length: 36775` | Prerendered static TV discovery shell with filter sidebar. | **PASS** |
| `/trending` | `GET` | `200 OK` | `text/html; charset=utf-8` | `X-Nextjs-Prerender: 1`<br>`Content-Length: 40673` | Prerendered static trending page shell. | **PASS** |
| `/search?q=Inception` | `GET` | `200 OK` | `text/html; charset=utf-8` | `Cache-Control: private, no-cache, no-store` | Dynamic server-rendered search page with query title "Search Results for: Inception". | **PASS** |
| `/api/genres?type=movie` | `GET` | `200 OK` | `application/json` | `Content-Type: application/json` | `[{"id":28,"name":"Action"},{"id":12,"name":"Adventure"},...]` (10 valid genres) | **PASS** |
| `/api/media?mediaType=movie` | `GET` | `200 OK` | `application/json` | `Content-Type: application/json` | `{"page":1,"results":[{"id":550,"title":"Fight Club","poster_path":"/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",...}],...}` | **PASS** |
| `/api/media?mediaType=tv` | `GET` | `200 OK` | `application/json` | `Content-Type: application/json` | `{"page":1,"results":[{"id":1399,"name":"Game of Thrones","poster_path":"/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg",...}],...}` | **PASS** |
| `/api/search/movie?q=Inception` | `GET` | `200 OK` | `application/json` | `Content-Type: application/json` | `{"page":1,"results":[{"id":27205,"title":"Inception",...}],"total_pages":1,"total_results":1}` | **PASS** |
| `/api/search/movie?q=NonExistentQuery` | `GET` | `200 OK` | `application/json` | `Content-Type: application/json` | `{"page":1,"results":[],"total_pages":0,"total_results":0}` (Negative control) | **PASS** |
| `/api/genres` (no params) | `GET` | `400 Bad Request` | `application/json` | `Content-Type: application/json` | `{"error":"Invalid type parameter"}` (Input guard intact) | **PASS** |
| `/api/search/movie` (no q) | `GET` | `400 Bad Request` | `application/json` | `Content-Type: application/json` | `{"error":"Query parameter 'q' is required"}` (Input guard intact) | **PASS** |
| `/api/search/movie?q=unauthorized_query` | `GET` | `500 Internal Server Error` | `application/json` | `Content-Type: application/json` | `{"error":"Failed to fetch movie search results"}` (Upstream error propagated) | **PASS** |

---

## 3. Visual Regression & Loaded-State Screenshot Gallery

### 3.1 Test Fixture & Execution Architecture
To guarantee full reproducibility without modifying application code:
1. **Committed Replayable Fixture:** [`docs/artifacts/cine-002/fixtures/mock_tmdb.cjs`](./fixtures/mock_tmdb.cjs) is tracked in Git. It intercepts outgoing `https.request` calls to `api.themoviedb.org`, mapping endpoints deterministically:
   - `/discover/movie` -> returns movies (*Fight Club*, *Interstellar*, *The Dark Knight*, *Inception*) with verified live poster and backdrop paths on `image.tmdb.org`.
   - `/discover/tv` -> returns dedicated TV series (*Game of Thrones*, *Breaking Bad*, *Stranger Things*, *Arcane*) with **pure TV field schema**: contains `name`, `original_name`, `first_air_date`, and zero `title` or `release_date` fields.
   - `/search/movie?query=Inception` -> returns *Inception* movie card.
   - `/search/movie?query=NonExistentQuery` -> returns empty results (`results: []`).
   - `/search/movie?query=unauthorized_query` -> returns HTTP 401 simulating missing/invalid TMDB credentials.
2. **Committed Portable Runner with Strict Gates:** [`docs/artifacts/cine-002/fixtures/capture_evidence.mjs`](./fixtures/capture_evidence.mjs) executes headless Chrome via Chrome DevTools Protocol (CDP):
   - **Cross-Platform Chrome Discovery:** Automatically searches `CHROME_BIN`, `CHROME_PATH`, and OS-standard paths across Windows, macOS, and Linux with cleanup traps on `SIGINT`/`SIGTERM`/`exit`.
   - **Configurable Environment Variables:** Parameterizes `TARGET_URL` (default `http://localhost:3055`), `CHROME_PORT` (default `9222`), `VIEWPORT_WIDTH`/`HEIGHT` (`1440x900`), and `OUTPUT_DIR`.
   - **Strict Image Completeness Assertion:** Verifies `loadedImages === totalImages`, `brokenImages === 0`, `pendingImages === 0`, and `totalImages >= minExpectedImages` on all affirmative cases.
   - **Strict Negative Search Assertion:** Checks `mediaCardCount === 0` using strict selectors (`article, [class*="MediaCard"], a[href*="/movie/"], a[href*="/tv/"]`), `totalImages === 0`, tab counter `"Movies (0)"`, and absence of false-positive cards.
   - **Strict Live DOM Error Assertion:** Directly reads the live error alert element (`[role="alert"]`) without fallback text, asserting that the message contains *"Failed to load search results. Please try again later."* and `mediaCardCount === 0`.
   - **Console & Exception Tracking:** Subscribes to `Runtime.consoleAPICalled` and `Runtime.exceptionThrown`, asserting `consoleErrors === 0` and `exceptions === 0`.
   - **Hydration Assertion:** Evaluates `window.__NEXT_HYDRATION_ERROR === null`.
   - **Nonzero Exit Code Enforcement:** Fails immediately with `process.exit(1)` if any test fails its assertion gate.
   - **Self-Test Mutation Mode:** Run with `--self-test` (`node ./docs/artifacts/cine-002/fixtures/capture_evidence.mjs --self-test`) to deterministically prove that an injected assertion mutation causes the runner to mark `pass: false` and fail.
3. **Committed Request & Assertion Logs:**
   - [`docs/artifacts/cine-002/fixtures/capture-results.json`](./fixtures/capture-results.json): Full machine-readable DOM evaluation summary for all 7 routes.
   - [`docs/artifacts/cine-002/fixtures/request-logs.json`](./fixtures/request-logs.json): Trace of all intercepted HTTP mock calls.

### 3.2 Loaded-State Screenshots Gallery

| Route | Artifact | Exact Bytes | PNG Dimensions | Rendered Content & Artwork Verification | Image Status | Console / Errors | Verdict |
| :--- | :--- | :---: | :---: | :--- | :---: | :---: | :---: |
| `/` (Root) | [`screenshot-root.png`](./screenshot-root.png) | 850,261 | 1440x900 | Loaded Hero with *Fight Club* backdrop; Daily Trending; Popular Movies (*Fight Club*, *Interstellar*, *The Dark Knight*, *Inception*); Popular TV Series (*Game of Thrones*, *Breaking Bad*, *Stranger Things*, *Arcane*). | 20/20 loaded (`naturalWidth > 0`, 0 broken, 0 pending) | 0 errors, 0 exceptions, null hydration | **PASS** |
| `/movie` | [`screenshot-movie.png`](./screenshot-movie.png) | 888,772 | 1440x900 | Filter sidebar + 12 movie cards with loaded poster artwork, release dates, titles, rating badges. | 12/12 loaded (`naturalWidth > 0`, 0 broken, 0 pending) | 0 errors, 0 exceptions, null hydration | **PASS** |
| `/tv` | [`screenshot-tv.png`](./screenshot-tv.png) | 889,700 | 1440x900 | Filter sidebar + 12 TV show cards displaying genuine TV titles (*Game of Thrones*, *Breaking Bad*, *Stranger Things*, *Arcane*) under pure TV schema (`name`, `first_air_date`). | 12/12 loaded (`naturalWidth > 0`, 0 broken, 0 pending) | 0 errors, 0 exceptions, null hydration | **PASS** |
| `/trending` | [`screenshot-trending.png`](./screenshot-trending.png) | 574,505 | 1440x900 | Header "Trending Movies & TV Shows" + 4 media cards across grid (*Fight Club*, *Interstellar*, *Game of Thrones*, *Breaking Bad*) with loaded posters. | 4/4 loaded (`naturalWidth > 0`, 0 broken, 0 pending) | 0 errors, 0 exceptions, null hydration | **PASS** |
| `/search?q=Inception` | [`screenshot-search.png`](./screenshot-search.png) | 338,328 | 1440x900 | Header "Search Results for: Inception", movie card for *Inception* with loaded poster artwork and rating 8.4. | 1/1 loaded (`naturalWidth > 0`, 0 broken, 0 pending) | 0 errors, 0 exceptions, null hydration | **PASS** |

### 3.3 Diagnostic & Negative Control Captures

| Test Case | Route | Artifact | Exact Bytes | PNG Dimensions | Observed Behavior & Assertion | Verdict |
| :--- | :--- | :--- | :---: | :---: | :--- | :---: |
| **Genuine Negative Search** | `/search?q=NonExistentQuery` | [`screenshot-search-negative.png`](./screenshot-search-negative.png) | 226,350 | 1440x900 | Heading "Search Results for: NonExistentQuery", tabs show `Movies (0)`, `TV (0)`, `People (0)`, `Keywords (0)`, strict media card selector count = 0, total images = 0. Zero false-positive cards. | **PASS** |
| **Unauthenticated Error State** | `/search?q=unauthorized_query` | [`screenshot-search-diagnostic-empty.png`](./screenshot-search-diagnostic-empty.png) | 228,874 | 1440x900 | Simulated upstream 401 triggers API 500; React Query retries settle and live DOM renders alert: *"Failed to load search results. Please try again later."* with 0 media cards. | **PASS** |

---

## 4. Browser Console & Hydration Verification

Automated Chrome CDP evaluations across all 7 routes:
- **Console Errors Recorded:** 0 (collected via `Runtime.consoleAPICalled`)
- **Uncaught Exceptions:** 0 (collected via `Runtime.exceptionThrown`)
- **Broken Image Tags (`naturalWidth === 0`):** 0 across all affirmative loaded routes
- **Pending Images (`complete === false`):** 0 across all affirmative loaded routes
- **Hydration Errors (`window.__NEXT_HYDRATION_ERROR`):** null (0)
