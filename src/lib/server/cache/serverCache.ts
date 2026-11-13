import { after, NextResponse } from "next/server";
import type { EndpointCachePolicy } from "./cachePolicies";

export type CacheStatus = "HIT" | "MISS" | "STALE" | "DEDUP" | "BYPASS";

export interface CacheFetchResult<T> {
  data: T;
  cacheStatus: CacheStatus;
  key: string;
}

export interface CacheMetricsSnapshot {
  hits: number;
  staleHits: number;
  misses: number;
  dedupedInFlight: number;
  revalidations: number;
  droppedRevalidations: number;
  rejectedInFlight: number;
  upstreamCalls: number;
  upstreamErrors: number;
  evictions: number;
  bypassedPrivate: number;
  entryCount: number;
  inFlightCount: number;
  revalidatingCount: number;
}

export class CacheConcurrencyLimitError extends Error {
  readonly code = "CACHE_IN_FLIGHT_LIMIT_EXCEEDED";

  constructor(maxInFlight: number) {
    super(`Server cache in-flight concurrency limit (${maxInFlight}) exceeded.`);
    this.name = "CacheConcurrencyLimitError";
  }
}

export type BackgroundTaskScheduler = (task: Promise<void>) => void;

function defaultBackgroundTaskScheduler(task: Promise<void>): void {
  try {
    after(async () => {
      await task;
    });
  } catch (err) {
    // Next.js `after()` requires an active App Router request scope; outside request scope
    // (e.g. unit/integration tests invoking handlers directly), the in-process promise remains
    // tracked via `this.revalidating` and `flushRevalidations()`.
    if (err instanceof Error && err.message.includes("outside a request scope")) {
      return;
    }
    throw err;
  }
}

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  freshUntil: number;
  staleUntil: number;
  lastAccessedSeq: number;
}

const FORBIDDEN_PUBLIC_KEY_PARTS = new Set([
  "cookie",
  "cookies",
  "authorization",
  "auth",
  "participantid",
  "participant_id",
  "token",
  "session",
  "sessionid",
  "session_id",
  "x-forwarded-for",
  "x-real-ip",
  "ip",
  "clientip",
]);

function normalizeKeyValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeKeyValue(item));
  }
  if (typeof value === "object") {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) {
        sortedObj[k] = normalizeKeyValue(v);
      }
    }
    return sortedObj;
  }
  return String(value);
}

/**
 * Builds an unambiguous, order-independent canonical cache key.
 * - Sorts keys lexicographically so parameter ordering never causes duplicates or collisions
 * - Preserves typed values (e.g. false vs "false", 1 vs "1") and delimiter characters
 * - Rejects private/session/IP parameter keys to prevent cross-user state leakage
 */
export function buildCanonicalCacheKey(
  namespace: string,
  params: Record<string, unknown> = {}
): string {
  const entries: [string, unknown][] = [];
  const sortedKeys = Object.keys(params).sort();

  for (const key of sortedKeys) {
    if (FORBIDDEN_PUBLIC_KEY_PARTS.has(key.toLowerCase())) {
      throw new Error(
        `SECURITY VIOLATION: Private/session parameter "${key}" is forbidden in public cache key for "${namespace}".`
      );
    }
    const val = params[key];
    if (val === undefined) {
      continue;
    }
    entries.push([key, normalizeKeyValue(val)]);
  }

  return `${namespace}::${JSON.stringify(entries)}`;
}

export interface ServerDataCacheOptions {
  clock?: () => number;
  defaultMaxEntries?: number;
  maxInFlight?: number;
  maxRevalidations?: number;
  scheduleBackgroundTask?: BackgroundTaskScheduler;
}

export class ServerDataCache {
  private readonly clock: () => number;
  private readonly defaultMaxEntries: number;
  private readonly maxInFlight: number;
  private readonly maxRevalidations: number;
  private readonly scheduleBackgroundTask: BackgroundTaskScheduler;
  private readonly stores = new Map<string, Map<string, CacheEntry<unknown>>>();
  private readonly inFlight = new Map<
    string,
    { promise: Promise<unknown>; waiters: number }
  >();
  private readonly revalidating = new Map<string, Promise<void>>();
  private accessCounter = 0;

  private metrics = {
    hits: 0,
    staleHits: 0,
    misses: 0,
    dedupedInFlight: 0,
    revalidations: 0,
    droppedRevalidations: 0,
    rejectedInFlight: 0,
    upstreamCalls: 0,
    upstreamErrors: 0,
    evictions: 0,
    bypassedPrivate: 0,
  };

  constructor(options: ServerDataCacheOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.defaultMaxEntries = Math.max(1, options.defaultMaxEntries ?? 1000);
    this.maxInFlight = Math.max(1, options.maxInFlight ?? 256);
    this.maxRevalidations = Math.max(1, options.maxRevalidations ?? 128);
    this.scheduleBackgroundTask =
      options.scheduleBackgroundTask ?? defaultBackgroundTaskScheduler;
  }

  /**
   * Executes a cached + request-deduplicated fetch according to the endpoint's declared policy.
   * - PRIVATE policies bypass shared storage completely.
   * - Concurrent identical MISS/EXPIRED requests share a single in-flight upstream promise.
   * - Errors are NEVER cached as success and immediately clear in-flight tracking.
   */
  async fetchWithPolicy<T>(
    policy: EndpointCachePolicy,
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<CacheFetchResult<T>> {
    if (policy.scope === "private" || policy.tier === "PRIVATE" || policy.ttlMs <= 0) {
      this.metrics.bypassedPrivate += 1;
      this.metrics.upstreamCalls += 1;
      try {
        const data = await fetcher();
        return {
          data,
          cacheStatus: "BYPASS",
          key: `private:${policy.id}`,
        };
      } catch (err) {
        this.metrics.upstreamErrors += 1;
        throw err;
      }
    }

    const key = buildCanonicalCacheKey(policy.id, params);
    const bucket = this.getBucket(policy.id);
    const now = this.clock();
    const existing = bucket.get(key) as CacheEntry<T> | undefined;

    if (existing) {
      // Fresh window: return immediately and touch LRU position
      if (now < existing.freshUntil) {
        this.touchEntry(bucket, key, existing);
        this.metrics.hits += 1;
        return {
          data: existing.value,
          cacheStatus: "HIT",
          key,
        };
      }

      // Bounded stale-while-revalidate window
      if (now < existing.staleUntil) {
        this.touchEntry(bucket, key, existing);
        this.metrics.staleHits += 1;
        this.triggerBackgroundRevalidation(key, policy, fetcher);
        return {
          data: existing.value,
          cacheStatus: "STALE",
          key,
        };
      }

      // Hard-expired entry: remove before miss fetch
      bucket.delete(key);
    }

    // Deduplicate concurrent cold or hard-expired misses
    const activeInFlight = this.inFlight.get(key);
    if (activeInFlight) {
      activeInFlight.waiters += 1;
      this.metrics.dedupedInFlight += 1;
      const data = (await activeInFlight.promise) as T;
      return {
        data,
        cacheStatus: "DEDUP",
        key,
      };
    }

    if (this.inFlight.size >= this.maxInFlight) {
      this.metrics.rejectedInFlight += 1;
      throw new CacheConcurrencyLimitError(this.maxInFlight);
    }

    this.metrics.misses += 1;
    this.metrics.upstreamCalls += 1;

    const promise = (async () => {
      try {
        const data = await fetcher();
        const completedAt = this.clock();
        this.writeEntry(key, data, completedAt, policy);
        return data;
      } catch (err) {
        this.metrics.upstreamErrors += 1;
        throw err;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, { promise, waiters: 0 });
    const data = await promise;
    return {
      data,
      cacheStatus: "MISS",
      key,
    };
  }

  private triggerBackgroundRevalidation<T>(
    key: string,
    policy: EndpointCachePolicy,
    fetcher: () => Promise<T>
  ): void {
    if (this.revalidating.has(key) || this.inFlight.has(key)) {
      return;
    }

    if (this.revalidating.size >= this.maxRevalidations) {
      this.metrics.droppedRevalidations += 1;
      return;
    }

    this.metrics.revalidations += 1;
    this.metrics.upstreamCalls += 1;

    const task = (async () => {
      try {
        const freshData = await fetcher();
        const completedAt = this.clock();
        this.writeEntry(key, freshData, completedAt, policy);
      } catch {
        // Never cache provider errors over valid data; let stale TTL bound expire naturally
        this.metrics.upstreamErrors += 1;
      } finally {
        this.revalidating.delete(key);
      }
    })();

    this.revalidating.set(key, task);
    this.scheduleBackgroundTask(task);
  }

  private getBucket(policyId: string): Map<string, CacheEntry<unknown>> {
    let bucket = this.stores.get(policyId);
    if (!bucket) {
      bucket = new Map<string, CacheEntry<unknown>>();
      this.stores.set(policyId, bucket);
    }
    return bucket;
  }

  private getTotalEntryCount(): number {
    let total = 0;
    for (const bucket of this.stores.values()) {
      total += bucket.size;
    }
    return total;
  }

  private touchEntry(
    bucket: Map<string, CacheEntry<unknown>>,
    key: string,
    entry: CacheEntry<unknown>
  ): void {
    entry.lastAccessedSeq = ++this.accessCounter;
    bucket.delete(key);
    bucket.set(key, entry);
  }

  private evictGlobalLeastRecentlyUsed(): boolean {
    let oldestBucket: Map<string, CacheEntry<unknown>> | undefined;
    let oldestKey: string | undefined;
    let oldestSeq = Number.POSITIVE_INFINITY;

    // Every policy bucket keeps insertion/touch LRU order, so each bucket's first entry
    // is that bucket's least-recently-used candidate. Comparing candidates across buckets
    // yields true global LRU eviction in O(number_of_buckets).
    for (const candidateBucket of this.stores.values()) {
      const first = candidateBucket.entries().next();
      if (first.done) continue;
      const [candidateKey, candidateEntry] = first.value;
      if (candidateEntry.lastAccessedSeq < oldestSeq) {
        oldestSeq = candidateEntry.lastAccessedSeq;
        oldestBucket = candidateBucket;
        oldestKey = candidateKey;
      }
    }

    if (!oldestBucket || oldestKey === undefined) {
      return false;
    }

    oldestBucket.delete(oldestKey);
    this.metrics.evictions += 1;
    return true;
  }

  private writeEntry<T>(
    key: string,
    value: T,
    now: number,
    policy: EndpointCachePolicy
  ): void {
    const bucket = this.getBucket(policy.id);
    const policyCap = Math.min(
      policy.maxEntries > 0 ? policy.maxEntries : this.defaultMaxEntries,
      this.defaultMaxEntries
    );

    if (bucket.has(key)) {
      bucket.delete(key);
    } else {
      while (bucket.size >= policyCap) {
        const oldestKey = bucket.keys().next().value;
        if (oldestKey === undefined) break;
        bucket.delete(oldestKey);
        this.metrics.evictions += 1;
      }
      // Enforce true global LRU eviction across all buckets
      while (this.getTotalEntryCount() >= this.defaultMaxEntries) {
        if (!this.evictGlobalLeastRecentlyUsed()) break;
      }
    }

    const freshUntil = now + policy.ttlMs;
    const staleUntil = freshUntil + Math.max(0, policy.staleWhileRevalidateMs);

    bucket.set(key, {
      value,
      createdAt: now,
      freshUntil,
      staleUntil,
      lastAccessedSeq: ++this.accessCounter,
    });
  }

  /**
   * Awaits any pending background SWR revalidations (useful in deterministic tests).
   */
  async flushRevalidations(): Promise<void> {
    if (this.revalidating.size === 0) return;
    await Promise.allSettled(Array.from(this.revalidating.values()));
  }

  getMetrics(): CacheMetricsSnapshot {
    return {
      ...this.metrics,
      entryCount: this.getTotalEntryCount(),
      inFlightCount: this.inFlight.size,
      revalidatingCount: this.revalidating.size,
    };
  }

  clear(): void {
    this.stores.clear();
    this.inFlight.clear();
    this.revalidating.clear();
    this.accessCounter = 0;
    this.metrics = {
      hits: 0,
      staleHits: 0,
      misses: 0,
      dedupedInFlight: 0,
      revalidations: 0,
      droppedRevalidations: 0,
      rejectedInFlight: 0,
      upstreamCalls: 0,
      upstreamErrors: 0,
      evictions: 0,
      bypassedPrivate: 0,
    };
  }
}

export const defaultServerCache = new ServerDataCache();

export function clearServerDataCache(): void {
  defaultServerCache.clear();
}

export function getServerCacheMetrics(): CacheMetricsSnapshot {
  return defaultServerCache.getMetrics();
}

export async function cachedServerFetch<T>(
  policy: EndpointCachePolicy,
  params: Record<string, unknown>,
  fetcher: () => Promise<T>
): Promise<CacheFetchResult<T>> {
  return defaultServerCache.fetchWithPolicy(policy, params, fetcher);
}

/**
 * Builds a NextResponse JSON payload with explicit Cache-Control, X-Cache, X-Cache-Tier,
 * and Vary headers matching the endpoint's declared policy.
 */
export function jsonWithCachePolicy<T>(
  data: T,
  policy: EndpointCachePolicy,
  cacheStatus: CacheStatus,
  init?: ResponseInit
): NextResponse<T> {
  const response = NextResponse.json(data, init);
  response.headers.set("Cache-Control", policy.cacheControlHeader);
  response.headers.set("X-Cache", cacheStatus);
  response.headers.set("X-Cache-Tier", policy.tier);
  if (policy.varyHeader) {
    response.headers.set("Vary", policy.varyHeader);
  }
  return response;
}
