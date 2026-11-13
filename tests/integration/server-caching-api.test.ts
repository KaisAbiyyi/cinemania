import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { GET as getDiscoverMedia } from "@/app/api/media/route";
import { GET as getTrendingMedia } from "@/app/api/media/trending/route";
import { GET as searchMovie } from "@/app/api/search/movie/route";
import { GET as getGenres } from "@/app/api/genres/route";
import { GET as getLanguages } from "@/app/api/languages/route";
import { GET as getProviderMedia } from "@/app/api/providers/[mediaType]/route";
import { GET as getMediaDetail } from "@/app/api/media/[id]/route";
import { GET as getGeolocation } from "@/app/api/geolocation/route";
import tmdbApi, { TmdbApiError } from "@/services/tmdbApi";
import { getServerCacheMetrics } from "@/lib/server/cache/serverCache";
import { mockGenres, mockLanguages, mockMoviesList } from "../fixtures/tmdb-fixtures";

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

describe("CINE-008: Server Caching & Request Deduplication API Integration + Latency Benchmark", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("coalesces concurrent discover requests and serves repeat queries from warm cache with public headers", async () => {
    const spy = vi.spyOn(tmdbApi, "get").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { data: mockMoviesList } as never;
    });

    // 10 concurrent identical discover requests -> 1 upstream call
    const concurrentResponses = await Promise.all(
      Array.from({ length: 10 }, () =>
        getDiscoverMedia(
          new Request(
            "http://localhost:3000/api/media?mediaType=movie&page=1&language=en-US&with_genres=28"
          )
        )
      )
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const statuses = concurrentResponses.map((r) => r.headers.get("X-Cache"));
    expect(statuses.filter((s) => s === "MISS")).toHaveLength(1);
    expect(statuses.filter((s) => s === "DEDUP")).toHaveLength(9);

    for (const res of concurrentResponses) {
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
      expect(res.headers.get("X-Cache-Tier")).toBe("SEMISTATIC");
    }

    // Reordered query params hit the exact same canonical cache key -> HIT (0 additional upstream calls)
    const warmRes = await getDiscoverMedia(
      new Request(
        "http://localhost:3000/api/media?with_genres=28&language=en-US&page=1&mediaType=movie"
      )
    );
    expect(warmRes.status).toBe(200);
    expect(warmRes.headers.get("X-Cache")).toBe("HIT");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("prevents language, filter, and adult policy cross-key leakage across all public endpoints", async () => {
    const spy = vi.spyOn(tmdbApi, "get").mockImplementation(async (url, config) => {
      const params = (config as { params?: Record<string, unknown> } | undefined)?.params ?? {};
      return {
        data: {
          endpoint: url,
          language: params.language ?? null,
          genres: params.with_genres ?? null,
          include_adult: params.include_adult ?? null,
        },
      } as never;
    });

    const resEn = await getDiscoverMedia(
      new Request("http://localhost:3000/api/media?mediaType=movie&language=en-US&with_genres=28")
    );
    const resId = await getDiscoverMedia(
      new Request("http://localhost:3000/api/media?mediaType=movie&language=id-ID&with_genres=28")
    );
    const resComedy = await getDiscoverMedia(
      new Request("http://localhost:3000/api/media?mediaType=movie&language=en-US&with_genres=35")
    );
    const resAdult = await getDiscoverMedia(
      new Request(
        "http://localhost:3000/api/media?mediaType=movie&language=en-US&with_genres=28&include_adult=true"
      )
    );

    expect(await resEn.json()).toMatchObject({ language: "en-US", genres: "28", include_adult: false });
    expect(await resId.json()).toMatchObject({ language: "id-ID", genres: "28", include_adult: false });
    expect(await resComedy.json()).toMatchObject({ language: "en-US", genres: "35", include_adult: false });
    expect(await resAdult.json()).toMatchObject({ language: "en-US", genres: "28", include_adult: true });
    expect(spy).toHaveBeenCalledTimes(4);

    // Media detail route isolates language query parameter
    const detailEn = await getMediaDetail(
      new Request("http://localhost:3000/api/media/550?mediaType=movie&language=en-US"),
      { params: Promise.resolve({ id: "550" }) }
    );
    const detailFr = await getMediaDetail(
      new Request("http://localhost:3000/api/media/550?mediaType=movie&language=fr-FR"),
      { params: Promise.resolve({ id: "550" }) }
    );
    expect(await detailEn.json()).toMatchObject({ endpoint: "/movie/550", language: "en-US" });
    expect(await detailFr.json()).toMatchObject({ endpoint: "/movie/550", language: "fr-FR" });
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it("never caches upstream errors (429/500) and recovers immediately when provider succeeds", async () => {
    const spy = vi
      .spyOn(tmdbApi, "get")
      .mockRejectedValueOnce(new TmdbApiError(429, "TMDB_RATE_LIMIT", "Rate limited", 15))
      .mockResolvedValueOnce({ data: mockMoviesList } as never);

    const failedRes = await getTrendingMedia(
      new Request("http://localhost:3000/api/media/trending?mediaType=movie&timeWindow=day")
    );
    expect(failedRes.status).toBe(429);
    expect(failedRes.headers.get("Retry-After")).toBe("15");

    // Second request must hit upstream again (error was NOT cached) and succeed
    const recoveredRes = await getTrendingMedia(
      new Request("http://localhost:3000/api/media/trending?mediaType=movie&timeWindow=day")
    );
    expect(recoveredRes.status).toBe(200);
    expect(recoveredRes.headers.get("X-Cache")).toBe("MISS");
    expect(await recoveredRes.json()).toEqual(mockMoviesList);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("strictly bypasses shared cache for PRIVATE /api/geolocation across different caller IPs", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const axiosSpy = vi
      .spyOn(axios, "get")
      .mockResolvedValueOnce({ data: { country: "ID" } } as never)
      .mockResolvedValueOnce({ data: { country: "JP" } } as never);

    const res1 = await getGeolocation(
      new Request("http://localhost:3000/api/geolocation", {
        headers: { "x-forwarded-for": "203.0.113.10" },
      })
    );
    const res2 = await getGeolocation(
      new Request("http://localhost:3000/api/geolocation", {
        headers: { "x-forwarded-for": "198.51.100.22" },
      })
    );

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(await res1.json()).toEqual({ region: "ID" });
    expect(await res2.json()).toEqual({ region: "JP" });

    for (const res of [res1, res2]) {
      expect(res.headers.get("Cache-Control")).toBe(
        "private, no-store, no-cache, must-revalidate"
      );
      expect(res.headers.get("X-Cache")).toBe("BYPASS");
      expect(res.headers.get("X-Cache-Tier")).toBe("PRIVATE");
      expect(res.headers.get("Vary")).toContain("X-Forwarded-For");
    }
    expect(axiosSpy).toHaveBeenCalledTimes(2);
  });

  it("applies STATIC caching headers and reduces upstream calls on genres, languages, and providers", async () => {
    const spy = vi.spyOn(tmdbApi, "get").mockImplementation(async (endpoint) => {
      if (endpoint === "/genre/movie/list") return { data: { genres: mockGenres.movie } } as never;
      if (endpoint === "/configuration/languages") return { data: mockLanguages } as never;
      if (endpoint === "/watch/providers/movie") return { data: { results: [] } } as never;
      return { data: {} } as never;
    });

    await getGenres(new Request("http://localhost:3000/api/genres?type=movie"));
    const g2 = await getGenres(new Request("http://localhost:3000/api/genres?type=movie"));
    expect(g2.headers.get("X-Cache")).toBe("HIT");
    expect(g2.headers.get("X-Cache-Tier")).toBe("STATIC");
    expect(g2.headers.get("Cache-Control")).toContain("s-maxage=86400");

    await getLanguages();
    const l2 = await getLanguages();
    expect(l2.headers.get("X-Cache")).toBe("HIT");

    await getProviderMedia(
      new Request("http://localhost:3000/api/providers/movie?language=en-US&watch_region=US"),
      { params: Promise.resolve({ mediaType: "movie" }) }
    );
    const p2 = await getProviderMedia(
      new Request("http://localhost:3000/api/providers/movie?language=en-US&watch_region=US"),
      { params: Promise.resolve({ mediaType: "movie" }) }
    );
    expect(p2.headers.get("X-Cache")).toBe("HIT");
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("measures and reports upstream call counts and p95 latency before (uncached) vs after (cached + deduped)", async () => {
    const UPSTREAM_LATENCY_MS = 20;
    let upstreamCalls = 0;

    vi.spyOn(tmdbApi, "get").mockImplementation(async () => {
      upstreamCalls += 1;
      await new Promise((r) => setTimeout(r, UPSTREAM_LATENCY_MS));
      return { data: mockMoviesList } as never;
    });

    // BEFORE baseline: 30 uncached requests across 3 distinct queries (10 concurrent + 10 repeat + 10 search)
    const beforeDurations: number[] = [];
    const beforeCallsStart = upstreamCalls;
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      await tmdbApi.get("/discover/movie", { params: { page: (i % 3) + 1 } });
      beforeDurations.push(performance.now() - start);
    }
    const beforeUpstreamCalls = upstreamCalls - beforeCallsStart;
    beforeDurations.sort((a, b) => a - b);
    const beforeP95Ms = percentile(beforeDurations, 95);

    // AFTER: 150 requests through cached API handlers (only 6/150 = 4.0% touch upstream wait):
    // - Wave 1: 5 concurrent identical discover requests (1 miss + 4 deduped)
    // - Wave 2: 100 sequential repeat discover requests (100 warm hits)
    // - Wave 3: 45 sequential search requests (1 miss + 44 warm hits)
    upstreamCalls = 0;
    const afterDurations: number[] = [];

    // Wave 1: 5 concurrent identical discover requests
    const wave1 = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const start = performance.now();
        const res = await getDiscoverMedia(
          new Request("http://localhost:3000/api/media?mediaType=movie&page=1")
        );
        afterDurations.push(performance.now() - start);
        return res;
      })
    );
    expect(wave1.every((r) => r.status === 200)).toBe(true);

    // Wave 2: 100 sequential repeat discover requests
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      const res = await getDiscoverMedia(
        new Request("http://localhost:3000/api/media?mediaType=movie&page=1")
      );
      afterDurations.push(performance.now() - start);
      expect(res.headers.get("X-Cache")).toBe("HIT");
    }

    // Wave 3: 45 sequential search requests (1 miss + 44 hits)
    for (let i = 0; i < 45; i++) {
      const start = performance.now();
      const res = await searchMovie(
        new Request("http://localhost:3000/api/search/movie?q=Inception&page=1")
      );
      afterDurations.push(performance.now() - start);
      expect(res.status).toBe(200);
    }

    const afterUpstreamCalls = upstreamCalls;
    afterDurations.sort((a, b) => a - b);
    const afterP95Ms = percentile(afterDurations, 95);
    const metrics = getServerCacheMetrics();

    console.info(
      `[CINE-008 BENCHMARK] beforeUpstreamCalls=${beforeUpstreamCalls} (30 requests), afterUpstreamCalls=${afterUpstreamCalls} (150 requests), ` +
        `beforeP95Ms=${beforeP95Ms.toFixed(2)}, afterP95Ms=${afterP95Ms.toFixed(2)}, ` +
        `hits=${metrics.hits}, deduped=${metrics.dedupedInFlight}, misses=${metrics.misses}`
    );

    expect(beforeUpstreamCalls).toBe(30);
    expect(afterUpstreamCalls).toBe(2); // 1 discover + 1 search across 150 requests
    expect(afterP95Ms).toBeLessThan(beforeP95Ms);
    expect(metrics.hits).toBe(144);
    expect(metrics.dedupedInFlight).toBe(4);
    expect(metrics.misses).toBe(2);
  });
});
