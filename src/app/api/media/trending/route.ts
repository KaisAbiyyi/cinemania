import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import { handleApiError } from "@/lib/api/errorResponse";
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

    const { data } = await tmdbApi.get(endpoint, { params: upstreamParams });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
