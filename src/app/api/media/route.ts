import tmdbApi from "@/services/tmdbApi";
import { handleApiError } from "@/lib/api/errorResponse";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { cachedServerFetch, jsonWithCachePolicy } from "@/lib/server/cache/serverCache";
import {
  ALLOWED_DISCOVER_KEYS,
  discoverMediaSchema,
  extractAndGuardQueryParams,
} from "@/lib/schemas/discoverSearch";

/**
 * Validated API Route for TMDB Discover Endpoint.
 * Supports mediaType: "movie" | "tv"
 *
 * Enforces:
 * - Allowed query key whitelist (no arbitrary parameter passthrough)
 * - Page range bounds (1..500)
 * - Safe length and repeated parameter bounds
 * - Protocol injection protection
 * - Explicit adult policy (default: false)
 * - Normalized error mapping (400 for invalid input, 502/503/429 for upstream)
 * - Bounded server caching & singleflight request deduplication (CINE-008)
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawParams = extractAndGuardQueryParams(url.searchParams, ALLOWED_DISCOVER_KEYS);
    const validated = discoverMediaSchema.parse(rawParams);

    const { mediaType, include_adults, ...filterParams } = validated;
    if (include_adults !== undefined && filterParams.include_adult === undefined) {
      filterParams.include_adult = include_adults;
    }
    const endpoint = mediaType === "movie" ? "/discover/movie" : "/discover/tv";

    // Clean up undefined / empty filter values for upstream TMDB request
    const upstreamParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filterParams)) {
      if (value !== undefined && value !== "") {
        upstreamParams[key] = value;
      }
    }

    const policy = ENDPOINT_CACHE_POLICIES.media_discover;
    const { data, cacheStatus } = await cachedServerFetch(
      policy,
      { mediaType, ...upstreamParams },
      async () => {
        const res = await tmdbApi.get(endpoint, { params: upstreamParams });
        return res.data;
      }
    );
    return jsonWithCachePolicy(data, policy, cacheStatus);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
