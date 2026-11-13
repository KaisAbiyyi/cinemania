import tmdbApi from "@/services/tmdbApi";
import { handleApiError } from "@/lib/api/errorResponse";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { cachedServerFetch, jsonWithCachePolicy } from "@/lib/server/cache/serverCache";
import {
  ALLOWED_TRENDING_KEYS,
  extractAndGuardQueryParams,
  trendingMediaSchema,
} from "@/lib/schemas/discoverSearch";

/**
 * Validated API Route for TMDB Trending Media.
 * Route: /api/media/trending
 *
 * Enforces:
 * - mediaType: "all" | "movie" | "tv"
 * - timeWindow: "day" | "week"
 * - page bounds 1..500
 * - normalized error responses
 * - bounded server caching & singleflight request deduplication (CINE-008)
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawParams = extractAndGuardQueryParams(url.searchParams, ALLOWED_TRENDING_KEYS);
    const validated = trendingMediaSchema.parse(rawParams);

    const endpoint = `/trending/${validated.mediaType}/${validated.timeWindow}`;
    const upstreamParams: Record<string, unknown> = {
      page: validated.page,
      language: validated.language,
    };

    const policy = ENDPOINT_CACHE_POLICIES.media_trending;
    const { data, cacheStatus } = await cachedServerFetch(
      policy,
      {
        mediaType: validated.mediaType,
        timeWindow: validated.timeWindow,
        ...upstreamParams,
      },
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
