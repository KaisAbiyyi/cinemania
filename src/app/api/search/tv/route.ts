import tmdbApi from "@/services/tmdbApi";
import { handleApiError } from "@/lib/api/errorResponse";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { cachedServerFetch, jsonWithCachePolicy } from "@/lib/server/cache/serverCache";
import {
  ALLOWED_SEARCH_TV_KEYS,
  extractAndGuardQueryParams,
  searchTvSchema,
} from "@/lib/schemas/discoverSearch";

/**
 * Validated API Route for TMDB TV Search.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawParams = extractAndGuardQueryParams(url.searchParams, ALLOWED_SEARCH_TV_KEYS);
    const validated = searchTvSchema.parse(rawParams);

    const query = (validated.q || validated.query)!;
    const upstreamParams: Record<string, unknown> = {
      query,
      page: validated.page,
      language: validated.language,
      include_adult: validated.include_adult,
    };

    if (validated.year !== undefined) upstreamParams.first_air_date_year = validated.year;

    const policy = ENDPOINT_CACHE_POLICIES.search_tv;
    const { data, cacheStatus } = await cachedServerFetch(
      policy,
      upstreamParams,
      async () => {
        const res = await tmdbApi.get("/search/tv", { params: upstreamParams });
        return res.data;
      }
    );
    return jsonWithCachePolicy(data, policy, cacheStatus);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
