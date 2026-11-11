import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import { handleApiError } from "@/lib/api/errorResponse";
import {
  ALLOWED_SEARCH_MOVIE_KEYS,
  extractAndGuardQueryParams,
  searchMovieSchema,
} from "@/lib/schemas/discoverSearch";

/**
 * Validated API Route for TMDB Movie Search.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawParams = extractAndGuardQueryParams(url.searchParams, ALLOWED_SEARCH_MOVIE_KEYS);
    const validated = searchMovieSchema.parse(rawParams);

    const query = (validated.q || validated.query)!;
    const upstreamParams: Record<string, unknown> = {
      query,
      page: validated.page,
      language: validated.language,
      include_adult: validated.include_adult,
    };

    if (validated.year !== undefined) upstreamParams.year = validated.year;
    if (validated.primary_release_year !== undefined) {
      upstreamParams.primary_release_year = validated.primary_release_year;
    }

    const { data } = await tmdbApi.get("/search/movie", { params: upstreamParams });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
