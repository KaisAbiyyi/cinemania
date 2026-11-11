# CineMatch System Architecture & Route Catalog

This document provides the authoritative architectural reference for CineMatch, detailing the system topology, runtime environment, data flows, security boundaries, and the complete inventory of 29 UI pages and 27 API handlers.

It explicitly distinguishes between the **operational foundation implemented today** (movie discovery catalog, server-side route handlers, hardened TMDB client, and offline test mocks) and the **target collaborative engine in development** (realtime rooms, frozen rosters, 20-title decks, and unanimous consensus per ADR-002/ADR-003).

---

## 1. High-Level System Topology

```mermaid
flowchart TD
    subgraph Client Tier [Browser Client]
        UI[Next.js App Router UI]
        RQ[TanStack React Query Cache]
        FP[Filter & Theme Context Providers]
    end

    subgraph Server Tier [Next.js 16 Server / Node.js Serverless Functions]
        RSC[React Server Components / Dynamic Pages]
        API[27 API Route Handlers /api/* - Node.js Runtime]
        TMDB_SVC[Hardened TMDB Server Client src/services/tmdb-server-client.ts]
        GEO_SVC[Geolocation Proxy /api/geolocation]
        YT_SVC[YouTube Proxy /api/youtube]
    end

    subgraph External Providers [Upstream External Services]
        TMDB[(TMDB REST API v3 / v4 Bearer)]
        IPINFO[(ipinfo.io Geolocation)]
        YOUTUBE[(Google YouTube Data API v3)]
    end

    subgraph Offline Dev [Hermetic Development Mode]
        MOCK[Synthetic TMDB Interceptor mock_tmdb.cjs]
    end

    subgraph Target Collaborative Subsystem [Target Realtime Architecture - CINE-011-020]
        ROOM_COORD[Room State Coordinator & Outbox]
        REALTIME_BUS[(Supabase Realtime / PostgreSQL)]
    end

    UI <-->|Hydration / RSC Payload| RSC
    UI <-->|Fetch JSON API| API
    RQ <-->|Query Cache| API
    API --> TMDB_SVC
    API --> GEO_SVC
    API --> YT_SVC

    TMDB_SVC -.->|Development / CI Offline| MOCK
    TMDB_SVC -->|Production HTTPS / Bearer Token| TMDB
    GEO_SVC -->|HTTPS / IPINFO_TOKEN| IPINFO
    YT_SVC -->|HTTPS / YOUTUBE_API_KEY| YOUTUBE

    UI -.->|Target Planned Flow| Target Collaborative Subsystem
```

---

## 2. Technology Stack & Runtime Specifications

| Layer / Component | Technology | Version | Notes / Reference |
| :--- | :--- | :--- | :--- |
| **Runtime Environment** | Node.js LTS | `24.x` | Pinned in `.nvmrc` and `package.json#engines` |
| **Package Manager** | npm | `>=10.0.0` (11.19.0 verified) | Sole canonical toolchain; `package-lock.json` v3 |
| **Application Framework** | Next.js | `16.4.5` (Turbopack) | Modernized in CINE-002; CVE mitigations |
| **UI Library** | React / React DOM | `19.0.0` | Full React 19 compiler compatibility |
| **Styling & Design System** | Tailwind CSS / PostCSS | `v4.x` | `@tailwindcss/postcss` & modern tokens |
| **UI Primitives** | Radix UI | Latest | Dialog, Popover, Select, Dropdown, Tabs |
| **Command Palette** | cmdk | `^1.1.1` | Native React 19 peer dependency resolution |
| **Date Selection** | react-day-picker | `^9.14.0` | DayPicker v9 component API; zero date-fns collision |
| **Client State & Cache** | TanStack React Query | `^5.67.2` | Global QueryClient in `src/app/layout.tsx` |
| **HTTP Client (Server)** | Axios | `^1.8.2` | Hardened server-only client in `src/services/tmdb-server-client.ts` |
| **Icons** | Lucide React | `^0.479.0` | Accessible SVG icon primitives |

---

## 3. Directory & Source Layout

```text
cinemania/
├── .nvmrc                         # Node 24 runtime pinning
├── vercel.json                    # Enforces npm ci & npm run build in cloud
├── package.json                   # Dependencies, scripts, and engine constraints
├── package-lock.json              # Canonical v3 lockfile
├── eslint.config.mjs              # ESLint 9 flat config (ignores docs/**)
├── next.config.ts                 # Next.js 16 configuration
├── docs/                          # Architectural documentation & evidence
│   ├── adr/                       # Architecture Decision Records (ADR-001, ADR-002)
│   ├── architecture/              # System architecture & route catalog
│   ├── artifacts/                 # Visual and HTTP evidence (cine-002 screenshots, fixtures)
│   │   └── cine-002/fixtures/     # Synthetic TMDB mock interceptor & runners
│   └── audits/                    # CINE-001 baseline audit reports
├── public/                        # Static public assets
└── src/
    ├── app/                       # Next.js App Router (29 pages + 27 API routes)
    │   ├── api/                   # API Route Handlers (27 files)
    │   ├── genre/                 # Genre exploration routes
    │   ├── keyword/               # Keyword exploration routes
    │   ├── movie/                 # Movie discovery and detail routes
    │   ├── person/                # Actor / crew bio and media routes
    │   ├── search/                # Unified search routes
    │   ├── trending/              # Trending media index
    │   └── tv/                    # TV show discovery and detail routes
    ├── components/                # Reusable UI components & shadcn primitives
    ├── feature/                   # Feature-sliced modules (home, media, person)
    ├── hooks/                     # Custom React hooks (e.g. useGeolocation, useMobile)
    ├── lib/                       # Utilities and helper functions (utils.ts)
    └── services/                  # Server-side external API service clients
```

---

## 4. Reconciled Route Catalog

### 4.1 UI Pages (`src/app/**/page.tsx` — 29 Files)

| # | Route URL | File Path | Rendering Mode | Description |
| :-: | :--- | :--- | :---: | :--- |
| 1 | `/` | `src/app/page.tsx` | Dynamic | CineMatch root landing page with hero banner & trending feeds |
| 2 | `/movie` | `src/app/movie/page.tsx` | Static | Movie discovery directory with faceted filtering |
| 3 | `/movie/now-playing` | `src/app/movie/now-playing/page.tsx` | Static | In-theaters movie release list |
| 4 | `/movie/top-rated` | `src/app/movie/top-rated/page.tsx` | Static | All-time highest rated movies |
| 5 | `/movie/upcoming` | `src/app/movie/upcoming/page.tsx` | Static | Upcoming movie releases calendar |
| 6 | `/movie/[slug]` | `src/app/movie/[slug]/page.tsx` | Dynamic | Primary movie detail page with synopsis, cast & watch providers |
| 7 | `/movie/[slug]/cast` | `src/app/movie/[slug]/cast/page.tsx` | Dynamic | Complete cast and crew listing for a movie |
| 8 | `/movie/[slug]/images` | `src/app/movie/[slug]/images/page.tsx` | Dynamic | Backdrops and poster gallery for a movie |
| 9 | `/movie/[slug]/reviews` | `src/app/movie/[slug]/reviews/page.tsx` | Dynamic | Verified user reviews and critiques |
| 10 | `/movie/[slug]/videos` | `src/app/movie/[slug]/videos/page.tsx` | Dynamic | Official trailers, teasers, and clips |
| 11 | `/tv` | `src/app/tv/page.tsx` | Static | TV series discovery directory with genre & network filters |
| 12 | `/tv/airing-today` | `src/app/tv/airing-today/page.tsx` | Static | Television episodes broadcasting today |
| 13 | `/tv/on-tv` | `src/app/tv/on-tv/page.tsx` | Static | Currently active on-air television series |
| 14 | `/tv/top-rated` | `src/app/tv/top-rated/page.tsx` | Static | All-time highest rated television shows |
| 15 | `/tv/[slug]` | `src/app/tv/[slug]/page.tsx` | Dynamic | TV series detail page with season guide and cast |
| 16 | `/tv/[slug]/cast` | `src/app/tv/[slug]/cast/page.tsx` | Dynamic | Comprehensive cast and creator listing for TV series |
| 17 | `/tv/[slug]/images` | `src/app/tv/[slug]/images/page.tsx` | Dynamic | TV show image stills, logos, and posters |
| 18 | `/tv/[slug]/reviews` | `src/app/tv/[slug]/reviews/page.tsx` | Dynamic | Audience and critic reviews for TV series |
| 19 | `/tv/[slug]/videos` | `src/app/tv/[slug]/videos/page.tsx` | Dynamic | Teaser and trailer video gallery for TV series |
| 20 | `/trending` | `src/app/trending/page.tsx` | Static | Weekly and daily trending movies and TV series |
| 21 | `/search` | `src/app/search/page.tsx` | Dynamic | Multi-search results page with tabbed query views |
| 22 | `/person/[slug]` | `src/app/person/[slug]/page.tsx` | Dynamic | Cast/crew member biography and filmography |
| 23 | `/person/[slug]/images` | `src/app/person/[slug]/images/page.tsx` | Dynamic | High-resolution photography of actor/director |
| 24 | `/genre/[slug]` | `src/app/genre/[slug]/page.tsx` | Dynamic | Overview of media titles matching a genre slug |
| 25 | `/genre/[slug]/movie` | `src/app/genre/[slug]/movie/page.tsx` | Dynamic | Filtered movie listing for a specific genre |
| 26 | `/genre/[slug]/tv` | `src/app/genre/[slug]/tv/page.tsx` | Dynamic | Filtered TV listing for a specific genre |
| 27 | `/keyword/[slug]` | `src/app/keyword/[slug]/page.tsx` | Dynamic | Keyword topic tag index page |
| 28 | `/keyword/[slug]/movie`| `src/app/keyword/[slug]/movie/page.tsx` | Dynamic | Movies associated with a thematic keyword |
| 29 | `/keyword/[slug]/tv` | `src/app/keyword/[slug]/tv/page.tsx` | Dynamic | TV series associated with a thematic keyword |

---

### 4.2 API Route Handlers (`src/app/api/**/route.ts` — 27 Files)

| # | Route Endpoint | HTTP | Upstream TMDB / External Mapping | Purpose |
| :-: | :--- | :---: | :--- | :--- |
| 1 | `/api/genres` | GET | `/genre/{mediaType}/list` | Fetches available movie or TV genres |
| 2 | `/api/geolocation` | GET | `https://ipinfo.io/{ip}?token={token}` | Proxies user IP to determine country code |
| 3 | `/api/keywords` | GET | `/keyword/{keyword_id}` | Resolves keyword tag details |
| 4 | `/api/languages` | GET | `/configuration/languages` | Lists supported ISO languages |
| 5 | `/api/media` | GET | `/discover/{mediaType}` | Executes complex faceted media filtering |
| 6 | `/api/media/trending` | GET | `/trending/{media_type}/{time_window}` | Retrieves daily/weekly trending media |
| 7 | `/api/media/[id]` | GET | `/{mediaType}/{id}` | Primary metadata for single movie or TV show |
| 8 | `/api/media/[id]/aggregate_credits` | GET | `/tv/{id}/aggregate_credits` | Aggregated full-series cast credits |
| 9 | `/api/media/[id]/content_ratings` | GET | `/tv/{id}/content_ratings` | TV parental maturity guidelines |
| 10 | `/api/media/[id]/credits` | GET | `/{mediaType}/{id}/credits` | Cast and crew credits for title |
| 11 | `/api/media/[id]/images` | GET | `/{mediaType}/{id}/images` | High-res backdrops and poster links |
| 12 | `/api/media/[id]/keywords` | GET | `/{mediaType}/{id}/keywords` | Subject tags associated with title |
| 13 | `/api/media/[id]/recommendations` | GET | `/{mediaType}/{id}/recommendations`| Algorithmic recommendations from TMDB |
| 14 | `/api/media/[id]/release_dates` | GET | `/movie/{id}/release_dates` | Theatrical, digital & physical release dates |
| 15 | `/api/media/[id]/reviews` | GET | `/{mediaType}/{id}/reviews` | Paginated user reviews |
| 16 | `/api/media/[id]/similar` | GET | `/{mediaType}/{id}/similar` | Similar titles based on genre & keywords |
| 17 | `/api/media/[id]/videos` | GET | `/{mediaType}/{id}/videos` | YouTube video IDs for official trailers |
| 18 | `/api/person/[id]` | GET | `/person/{id}` | Detailed biography and birth metadata |
| 19 | `/api/person/[id]/combined_credits` | GET | `/person/{id}/combined_credits` | Full career filmography across TV & film |
| 20 | `/api/person/[id]/images` | GET | `/person/{id}/images` | Profile photography gallery |
| 21 | `/api/providers/region` | GET | `/watch/providers/regions` | Valid regional watch provider codes |
| 22 | `/api/providers/[mediaType]` | GET | `/watch/providers/{mediaType}` | Streaming services (Netflix, Max, etc.) |
| 23 | `/api/search/keyword` | GET | `/search/keyword` | Autocomplete search for keywords |
| 24 | `/api/search/movie` | GET | `/search/movie` | Fuzzy text search for movies |
| 25 | `/api/search/person` | GET | `/search/person` | Search for actors, directors & crew |
| 26 | `/api/search/tv` | GET | `/search/tv` | Fuzzy text search for TV shows |
| 27 | `/api/youtube` | GET | Google YouTube Data API v3 (`/videos`)| Fetches video title, channel & metadata |

---

## 5. Security & Environment Architecture

### 5.1 Environment Variable Boundary Model

```mermaid
flowchart LR
    subgraph Public Scope [Client Accessible]
        NEXT_PUBLIC_TMDB_POSTER_URL[NEXT_PUBLIC_TMDB_POSTER_URL]
        NEXT_PUBLIC_IMAGE_BASE_URL[NEXT_PUBLIC_IMAGE_BASE_URL]
    end

    subgraph Private Scope [Server-Only Secrets]
        TMDB_API_RAT[TMDB_API_RAT - v4 Bearer Token]
        YOUTUBE_API_KEY[YOUTUBE_API_KEY - Google Cloud Key]
        IPINFO_TOKEN[IPINFO_TOKEN - ipinfo.io Token]
    end

    Public Scope -->|Embedded in HTML / JS Bundle| Browser[User Browser]
    Private Scope -->|Confined to Node.js Serverless Functions| NextServer[Next.js Server]
```

- **Zero Secret Infiltration:** The `NEXT_PUBLIC_` prefix is strictly prohibited for API keys or authorization tokens.
- **Header Injection:** `TMDB_API_RAT` is injected exclusively in `src/services/tmdb-server-client.ts` (hardened in CINE-006) as `Authorization: Bearer <token>`.
- **Defensive Error Handling:**
  - When `YOUTUBE_API_KEY` is missing, `/api/youtube` returns HTTP 500 with `{ "error": "Server configuration error" }`.
  - When `IPINFO_TOKEN` is missing, `/api/geolocation` detects local IP requests and safely returns `{ "region": "US" }`.

### 5.2 Offline Onboarding and Network Guard Boundary
- **Fixture-Backed Hermetic Mode:** Onboarding and local development can run fully offline using the deterministic mock interceptor (`docs/artifacts/cine-002/fixtures/mock_tmdb.cjs`).
- **Initial-Call and Redirect Guard Scope:** In hermetic test verification, `docs/artifacts/cine-005/hermetic_network_guard.cjs` wraps `node:http`, `node:https`, and `globalThis.fetch`. It enforces a strict loopback-only wire policy (`localhost`, `127.0.0.1`, `::1`), blocking initial external requests and 3xx redirects to external destinations with `[FAIL_CLOSED]`. This guarantees initial-call and redirect guard coverage for Node.js standard HTTP/HTTPS/fetch paths without making false claims of kernel-level sandbox isolation.
- **Isolated Scratch Execution:** The onboarding test runner executes Next.js production builds inside a disposable scratch directory in `os.tmpdir()` with directory junctions to `.next` and `node_modules`. Because the scratch directory contains zero `.env*` files, Next.js cannot discover or load local developer credentials, providing true hermetic environment isolation without modifying developer files in the workspace.
