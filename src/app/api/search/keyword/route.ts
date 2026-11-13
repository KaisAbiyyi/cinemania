import tmdbApi from "@/services/tmdbApi";
import { handleApiError } from "@/lib/api/errorResponse";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { cachedServerFetch, jsonWithCachePolicy } from "@/lib/server/cache/serverCache";
import {
  ALLOWED_SEARCH_KEYWORD_KEYS,
  extractAndGuardQueryParams,
  searchKeywordSchema,
} from "@/lib/schemas/discoverSearch";

/**
 * Validated API Route for TMDB Keyword Search.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawParams = extractAndGuardQueryParams(url.searchParams, ALLOWED_SEARCH_KEYWORD_KEYS);
    const validated = searchKeywordSchema.parse(rawParams);

    const query = validated.q || validated.query;
    const upstreamParams = {
      query,
      page: validated.page,
    };

    const policy = ENDPOINT_CACHE_POLICIES.search_keyword;
    const { data, cacheStatus } = await cachedServerFetch(
      policy,
      upstreamParams,
      async () => {
        const res = await tmdbApi.get("/search/keyword", { params: upstreamParams });
        return res.data;
      }
    );
    return jsonWithCachePolicy(data, policy, cacheStatus);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
