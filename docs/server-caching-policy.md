# Server Data Caching & Request Deduplication Policy (CINE-008)

- **Task Reference:** [CINE-008 · Server data caching and request deduplication](https://github.com/KaisAbiyyi/cinemania/issues/10)
- **Implementation Modules:**
  - `src/lib/server/cache/cachePolicies.ts`
  - `src/lib/server/cache/serverCache.ts`
  - `src/lib/server/cache/tmdbRouteHelper.ts`

---

## 1. Core Guarantees & Non-Negotiable Constraints

1. **Public vs Private Isolation:**
   - Endpoints classified as `PRIVATE` (`scope: "private"`, `ttlMs: 0`) **never** read from or write to the shared server cache and always respond with `Cache-Control: private, no-store, no-cache, must-revalidate` and `X-Cache: BYPASS`.
   - `buildCanonicalCacheKey()` rejects private/session parameter names (`cookie`, `authorization`, `participantId`, `token`, `session`, `x-forwarded-for`, `x-real-ip`, `ip`) at runtime so private state can never enter a public cache key.
2. **Error Non-Caching:**
   - Upstream provider errors (401, 404, 429, 500, 502, 503, 504, network/timeout faults) are **never** cached as success.
   - Failed in-flight misses immediately clear the singleflight slot so subsequent requests recover cleanly.
   - Failed background stale-while-revalidate (SWR) refreshes do not overwrite valid entries and never extend stale lifetimes past `staleUntil`.
   - API error responses set `Cache-Control: no-store`.
3. **Variant & Cross-Key Safety:**
   - Canonical cache keys serialize sorted `[key, normalizedValue]` JSON tuples so parameter ordering is normalized while `language`, `page`, `mediaType`, `watch_region`, `include_adult`, and all filter parameters remain strictly isolated.
   - Delimiter characters (`&`, `=`, `:`) and typed values (`false` vs `"false"`) cannot collide.
4. **Singleflight Deduplication & Bounded Memory:**
   - Concurrent identical misses coalesce onto a single upstream request (`X-Cache: DEDUP`).
   - Concurrent requests in the bounded SWR window trigger at most one background refresh.
   - Every policy enforces an explicit bounded LRU capacity (`maxEntries`) plus a global entry cap.

---

## 2. Per-Endpoint Classification & Policy Matrix

### Tier 1: `STATIC` — Long-TTL Public Catalog Reference Metadata
- **TTL:** 24 hours (`86,400,000 ms`)
- **Stale-While-Revalidate:** 1 hour (`3,600,000 ms`)
- **HTTP Header:** `public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600`

| Policy ID | Route | Cache Key Dimensions | Max Entries |
| :--- | :--- | :--- | :--- |
| `genres` | `GET /api/genres` | `type` | 32 |
| `languages` | `GET /api/languages` | `(none)` | 8 |
| `providers_region` | `GET /api/providers/region` | `language` | 64 |
| `providers_media` | `GET /api/providers/[mediaType]` | `mediaType`, `language`, `watch_region` | 256 |

### Tier 2: `SEMISTATIC` — Public Discovery, Search & Media/Person Details

| Policy ID | Route | TTL | SWR | Max Entries | HTTP `Cache-Control` | Key Dimensions |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `media_discover` | `GET /api/media` | 5m (`300s`) | 10m (`600s`) | 512 | `public, max-age=60, s-maxage=300, stale-while-revalidate=600` | `mediaType`, `page`, `language`, `sort_by`, `include_adult`, all validated discover filters |
| `media_trending` | `GET /api/media/trending` | 5m (`300s`) | 10m (`600s`) | 256 | `public, max-age=60, s-maxage=300, stale-while-revalidate=600` | `mediaType`, `timeWindow`, `page`, `language` |
| `search_movie` | `GET /api/search/movie` | 5m (`300s`) | 5m (`300s`) | 512 | `public, max-age=60, s-maxage=300, stale-while-revalidate=300` | `query`, `page`, `language`, `include_adult`, `year`, `primary_release_year` |
| `search_tv` | `GET /api/search/tv` | 5m (`300s`) | 5m (`300s`) | 512 | `public, max-age=60, s-maxage=300, stale-while-revalidate=300` | `query`, `page`, `language`, `include_adult`, `first_air_date_year` |
| `search_person` | `GET /api/search/person` | 5m (`300s`) | 5m (`300s`) | 256 | `public, max-age=60, s-maxage=300, stale-while-revalidate=300` | `query`, `page`, `language`, `include_adult` |
| `search_keyword` | `GET /api/search/keyword` | 10m (`600s`) | 10m (`600s`) | 256 | `public, max-age=120, s-maxage=600, stale-while-revalidate=600` | `query`, `page` |
| `keywords` | `GET /api/keywords` | 10m (`600s`) | 10m (`600s`) | 256 | `public, max-age=120, s-maxage=600, stale-while-revalidate=600` | `query`, `page` |
| `media_detail` | `GET /api/media/[id]` | 30m (`1800s`) | 30m (`1800s`) | 512 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `mediaType`, `id`, forwarded query params |
| `media_credits` | `GET /api/media/[id]/credits` | 30m (`1800s`) | 30m (`1800s`) | 512 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `mediaType`, `id`, forwarded query params |
| `media_aggregate_credits` | `GET /api/media/[id]/aggregate_credits` | 30m (`1800s`) | 30m (`1800s`) | 256 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `id` |
| `media_content_ratings` | `GET /api/media/[id]/content_ratings` | 30m (`1800s`) | 30m (`1800s`) | 256 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `id` |
| `media_images` | `GET /api/media/[id]/images` | 30m (`1800s`) | 30m (`1800s`) | 512 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `mediaType`, `id`, forwarded query params |
| `media_keywords` | `GET /api/media/[id]/keywords` | 30m (`1800s`) | 30m (`1800s`) | 512 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `mediaType`, `id`, forwarded query params |
| `media_release_dates` | `GET /api/media/[id]/release_dates` | 30m (`1800s`) | 30m (`1800s`) | 256 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `mediaType`, `id` |
| `media_videos` | `GET /api/media/[id]/videos` | 30m (`1800s`) | 30m (`1800s`) | 512 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `mediaType`, `id`, forwarded query params |
| `media_recommendations` | `GET /api/media/[id]/recommendations` | 10m (`600s`) | 10m (`600s`) | 512 | `public, max-age=120, s-maxage=600, stale-while-revalidate=600` | `mediaType`, `id`, forwarded query params |
| `media_similar` | `GET /api/media/[id]/similar` | 10m (`600s`) | 10m (`600s`) | 512 | `public, max-age=120, s-maxage=600, stale-while-revalidate=600` | `mediaType`, `id`, forwarded query params |
| `media_reviews` | `GET /api/media/[id]/reviews` | 10m (`600s`) | 10m (`600s`) | 256 | `public, max-age=120, s-maxage=600, stale-while-revalidate=600` | `mediaType`, `id`, forwarded query params |
| `person_detail` | `GET /api/person/[id]` | 30m (`1800s`) | 30m (`1800s`) | 256 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `id` |
| `person_combined_credits` | `GET /api/person/[id]/combined_credits` | 30m (`1800s`) | 30m (`1800s`) | 256 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `id` |
| `person_images` | `GET /api/person/[id]/images` | 30m (`1800s`) | 30m (`1800s`) | 256 | `public, max-age=300, s-maxage=1800, stale-while-revalidate=1800` | `id` |
| `youtube_video` | `GET /api/youtube` | 60m (`3600s`) | 30m (`1800s`) | 256 | `public, max-age=600, s-maxage=3600, stale-while-revalidate=1800` | `videoId` (per-IP rate limit evaluated before cache lookup) |

### Tier 3: `PRIVATE` — Caller / Guest / Session / Room State (Never Shared-Cached)
- **TTL / SWR:** `0 ms` (Bypassed from shared cache completely)
- **HTTP Header:** `private, no-store, no-cache, must-revalidate`

| Policy ID | Route | Vary Header | Rationale |
| :--- | :--- | :--- | :--- |
| `geolocation` | `GET /api/geolocation` | `X-Forwarded-For, X-Real-Ip` | IP-derived caller region; must never bleed across users. |
| `guest_session` | `/api/guest/**` | `Cookie` | Guest capability cookies and session identity state. |
| `room_state` | `/api/rooms/**` | `Cookie` | Authoritative CineMatch room snapshots, roster, votes, and events. |

---

## 3. Serverless SWR Execution Model & Bounded Capacity

1. **Best-Effort Post-Response Revalidation (`after()`):**
   - When serving within the `STALE` window inside a Next.js App Router request lifecycle, `ServerDataCache` schedules the coalesced background upstream refresh via Next.js `after()` so the serverless runtime can complete the refresh after sending the stale response.
   - Outside a Next.js request scope (such as direct Route Handler unit/integration tests), scheduling falls back cleanly to in-process execution tracked by `flushRevalidations()`.
   - Because `ServerDataCache` is per-instance in-memory state, serverless background SWR is **best-effort**: if an instance is recycled before `after()` finishes, or subsequent traffic lands on a cold instance, requests degrade safely to synchronous `MISS` + singleflight upstream fetch while shared edge caches respect the emitted `Cache-Control: ..., stale-while-revalidate=...` headers.
2. **True Global LRU & Concurrency Caps:**
   - Every policy bucket enforces its `maxEntries` LRU limit (`bucket` Map access order), and `ServerDataCache` enforces a global entry cap (`defaultMaxEntries`, default `1000`) by evicting the **globally least-recently-accessed** entry across all policy buckets using monotonic access sequence numbers.
   - High-cardinality uncached bursts are bounded by explicit global admission limits on concurrent distinct keys (`maxInFlight`, default `256` — coalesced duplicates on active keys remain allowed) and concurrent background SWR tasks (`maxRevalidations`, default `128` — excess stale refreshes are dropped safely while stale responses continue serving).

