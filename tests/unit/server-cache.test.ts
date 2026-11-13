import { describe, it, expect } from "vitest";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import {
  ServerDataCache,
  buildCanonicalCacheKey,
} from "@/lib/server/cache/serverCache";

describe("CINE-008: ServerDataCache Unit Tests (Mock Clock, Singleflight, SWR, Variant Keys, Error Recovery)", () => {
  it("classifies all endpoints into STATIC, SEMISTATIC, and PRIVATE tiers with valid bounds", () => {
    const policies = Object.values(ENDPOINT_CACHE_POLICIES);
    expect(policies.length).toBeGreaterThanOrEqual(27);

    const staticPolicies = policies.filter((p) => p.tier === "STATIC");
    const semistaticPolicies = policies.filter((p) => p.tier === "SEMISTATIC");
    const privatePolicies = policies.filter((p) => p.tier === "PRIVATE");

    expect(staticPolicies.length).toBe(4);
    expect(semistaticPolicies.length).toBe(22);
    expect(privatePolicies.length).toBeGreaterThanOrEqual(3);

    for (const p of [...staticPolicies, ...semistaticPolicies]) {
      expect(p.scope).toBe("public");
      expect(p.ttlMs).toBeGreaterThan(0);
      expect(p.staleWhileRevalidateMs).toBeGreaterThanOrEqual(0);
      expect(p.maxEntries).toBeGreaterThan(0);
      expect(p.cacheControlHeader).toContain("public");
    }

    for (const p of privatePolicies) {
      expect(p.scope).toBe("private");
      expect(p.ttlMs).toBe(0);
      expect(p.staleWhileRevalidateMs).toBe(0);
      expect(p.cacheControlHeader).toContain("private");
      expect(p.cacheControlHeader).toContain("no-store");
    }
  });

  it("canonicalizes keys deterministically across parameter ordering and blocks cross-key/private leakage", () => {
    const k1 = buildCanonicalCacheKey("media_discover", {
      mediaType: "movie",
      language: "en-US",
      page: 1,
      with_genres: "28",
      include_adult: false,
    });
    const k2 = buildCanonicalCacheKey("media_discover", {
      include_adult: false,
      with_genres: "28",
      page: 1,
      language: "en-US",
      mediaType: "movie",
      sort_by: undefined,
    });
    expect(k1).toBe(k2);

    // Distinct language / filter / typed values produce distinct keys
    const kId = buildCanonicalCacheKey("media_discover", {
      mediaType: "movie",
      language: "id-ID",
      page: 1,
      with_genres: "28",
      include_adult: false,
    });
    const kDelimiterInjected = buildCanonicalCacheKey("media_discover", {
      mediaType: "movie",
      language: "en-US&page=2",
      page: 1,
      with_genres: "28",
      include_adult: false,
    });
    const kStringFalse = buildCanonicalCacheKey("media_discover", {
      mediaType: "movie",
      language: "en-US",
      page: 1,
      with_genres: "28",
      include_adult: "false",
    });

    expect(k1).not.toBe(kId);
    expect(k1).not.toBe(kDelimiterInjected);
    expect(k1).not.toBe(kStringFalse);

    // Rejects private/session/IP keys in public cache key construction
    for (const forbidden of [
      "cookie",
      "Authorization",
      "participantId",
      "session_id",
      "x-forwarded-for",
      "token",
    ]) {
      expect(() =>
        buildCanonicalCacheKey("media_discover", { [forbidden]: "secret" })
      ).toThrow(/SECURITY VIOLATION/);
    }
  });

  it("transitions cleanly across cold (MISS) -> warm (HIT) -> bounded stale (STALE) -> hard expiry (MISS) under mock clock", async () => {
    let now = 1_700_000_000_000;
    const cache = new ServerDataCache({ clock: () => now });
    const policy = ENDPOINT_CACHE_POLICIES.media_discover; // ttl 300s, swr 600s

    let upstreamCount = 0;
    const fetcher = async () => {
      upstreamCount += 1;
      return { version: upstreamCount };
    };

    // 1. Cold miss at t = 0
    const r1 = await cache.fetchWithPolicy(policy, { mediaType: "movie", page: 1 }, fetcher);
    expect(r1.cacheStatus).toBe("MISS");
    expect(r1.data).toEqual({ version: 1 });
    expect(upstreamCount).toBe(1);

    // 2. Warm hit at t = +299.9s (just before TTL expiry)
    now += policy.ttlMs - 1;
    const r2 = await cache.fetchWithPolicy(policy, { mediaType: "movie", page: 1 }, fetcher);
    expect(r2.cacheStatus).toBe("HIT");
    expect(r2.data).toEqual({ version: 1 });
    expect(upstreamCount).toBe(1);

    // 3. Stale hit inside SWR window at t = +300s -> returns stale v1, triggers 1 background refresh to v2
    now += 1;
    const [r3a, r3b] = await Promise.all([
      cache.fetchWithPolicy(policy, { mediaType: "movie", page: 1 }, fetcher),
      cache.fetchWithPolicy(policy, { mediaType: "movie", page: 1 }, fetcher),
    ]);
    expect(r3a.cacheStatus).toBe("STALE");
    expect(r3b.cacheStatus).toBe("STALE");
    expect(r3a.data).toEqual({ version: 1 });
    await cache.flushRevalidations();
    expect(upstreamCount).toBe(2); // Only ONE background revalidation!

    // 4. Subsequent request sees freshly revalidated v2 as HIT
    const r4 = await cache.fetchWithPolicy(policy, { mediaType: "movie", page: 1 }, fetcher);
    expect(r4.cacheStatus).toBe("HIT");
    expect(r4.data).toEqual({ version: 2 });
    expect(upstreamCount).toBe(2);

    // 5. Advance past TTL + SWR hard expiration -> next call is synchronous MISS (v3)
    now += policy.ttlMs + policy.staleWhileRevalidateMs + 1;
    const r5 = await cache.fetchWithPolicy(policy, { mediaType: "movie", page: 1 }, fetcher);
    expect(r5.cacheStatus).toBe("MISS");
    expect(r5.data).toEqual({ version: 3 });
    expect(upstreamCount).toBe(3);
  });

  it("deduplicates 25 concurrent identical cold requests into exactly 1 upstream call", async () => {
    const cache = new ServerDataCache();
    const policy = ENDPOINT_CACHE_POLICIES.media_discover;

    let upstreamCalls = 0;
    const fetcher = async () => {
      upstreamCalls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return { results: ["Inception"] };
    };

    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        cache.fetchWithPolicy(policy, { mediaType: "movie", language: "en-US", page: 1 }, fetcher)
      )
    );

    expect(upstreamCalls).toBe(1);
    expect(results.filter((r) => r.cacheStatus === "MISS")).toHaveLength(1);
    expect(results.filter((r) => r.cacheStatus === "DEDUP")).toHaveLength(24);
    for (const r of results) {
      expect(r.data).toEqual({ results: ["Inception"] });
    }
    expect(cache.getMetrics().dedupedInFlight).toBe(24);
  });

  it("never caches provider errors on cold miss or SWR background failure and recovers cleanly", async () => {
    let now = 1_700_000_000_000;
    const cache = new ServerDataCache({ clock: () => now });
    const policy = ENDPOINT_CACHE_POLICIES.search_movie; // ttl 300s, swr 300s

    let shouldFail = true;
    let upstreamCalls = 0;
    const fetcher = async () => {
      upstreamCalls += 1;
      if (shouldFail) {
        throw new Error("Upstream 429 rate limited");
      }
      return { ok: true, attempt: upstreamCalls };
    };

    // 1. Concurrent cold failure: all 3 callers receive rejection, nothing cached
    await expect(
      Promise.all([
        cache.fetchWithPolicy(policy, { query: "dune", page: 1 }, fetcher),
        cache.fetchWithPolicy(policy, { query: "dune", page: 1 }, fetcher),
        cache.fetchWithPolicy(policy, { query: "dune", page: 1 }, fetcher),
      ])
    ).rejects.toThrow("Upstream 429 rate limited");
    expect(upstreamCalls).toBe(1);
    expect(cache.getMetrics().entryCount).toBe(0);
    expect(cache.getMetrics().upstreamErrors).toBe(1);

    // 2. Provider recovers -> next request succeeds cleanly (MISS -> cached)
    shouldFail = false;
    const recovered = await cache.fetchWithPolicy(policy, { query: "dune", page: 1 }, fetcher);
    expect(recovered.cacheStatus).toBe("MISS");
    expect(recovered.data).toEqual({ ok: true, attempt: 2 });

    // 3. Enter SWR window while provider fails again -> stale v2 served, error NOT cached over v2
    now += policy.ttlMs + 10;
    shouldFail = true;
    const staleRes = await cache.fetchWithPolicy(policy, { query: "dune", page: 1 }, fetcher);
    expect(staleRes.cacheStatus).toBe("STALE");
    expect(staleRes.data).toEqual({ ok: true, attempt: 2 });
    await cache.flushRevalidations();
    expect(upstreamCalls).toBe(3);

    // 4. Hard expiry passes while provider still failing -> throws error (never serves stale past SWR bound!)
    now += policy.staleWhileRevalidateMs + 1;
    await expect(
      cache.fetchWithPolicy(policy, { query: "dune", page: 1 }, fetcher)
    ).rejects.toThrow("Upstream 429 rate limited");

    // 5. Provider recovers after hard expiry failure -> fresh call succeeds
    shouldFail = false;
    const recoveredAfterExpiry = await cache.fetchWithPolicy(
      policy,
      { query: "dune", page: 1 },
      fetcher
    );
    expect(recoveredAfterExpiry.cacheStatus).toBe("MISS");
    expect(recoveredAfterExpiry.data).toEqual({ ok: true, attempt: 5 });
  });

  it("never shares cache for PRIVATE policies", async () => {
    const cache = new ServerDataCache();
    let calls = 0;

    const r1 = await cache.fetchWithPolicy(
      ENDPOINT_CACHE_POLICIES.geolocation,
      {},
      async () => ({ region: "ID", seq: ++calls })
    );
    const r2 = await cache.fetchWithPolicy(
      ENDPOINT_CACHE_POLICIES.geolocation,
      {},
      async () => ({ region: "US", seq: ++calls })
    );

    expect(r1.cacheStatus).toBe("BYPASS");
    expect(r2.cacheStatus).toBe("BYPASS");
    expect(r1.data).toEqual({ region: "ID", seq: 1 });
    expect(r2.data).toEqual({ region: "US", seq: 2 });
    expect(calls).toBe(2);
    expect(cache.getMetrics().entryCount).toBe(0);
    expect(cache.getMetrics().bypassedPrivate).toBe(2);
  });

  it("enforces bounded LRU eviction per policy bucket without cross-policy thrashing", async () => {
    const cache = new ServerDataCache({ defaultMaxEntries: 100 });
    const smallPolicy = {
      ...ENDPOINT_CACHE_POLICIES.genres,
      id: "test_small_bucket",
      maxEntries: 2,
    };

    await cache.fetchWithPolicy(smallPolicy, { k: "a" }, async () => "A");
    await cache.fetchWithPolicy(smallPolicy, { k: "b" }, async () => "B");
    // Touch "a" so "b" becomes LRU
    const hitA = await cache.fetchWithPolicy(smallPolicy, { k: "a" }, async () => "A2");
    expect(hitA.cacheStatus).toBe("HIT");

    // Insert "c" -> should evict "b", NOT "a"
    await cache.fetchWithPolicy(smallPolicy, { k: "c" }, async () => "C");

    const checkA = await cache.fetchWithPolicy(smallPolicy, { k: "a" }, async () => "A3");
    const checkB = await cache.fetchWithPolicy(smallPolicy, { k: "b" }, async () => "B2");
    expect(checkA.cacheStatus).toBe("HIT");
    expect(checkA.data).toBe("A");
    expect(checkB.cacheStatus).toBe("MISS");
    expect(checkB.data).toBe("B2");
    expect(cache.getMetrics().evictions).toBeGreaterThanOrEqual(1);
  });
});
