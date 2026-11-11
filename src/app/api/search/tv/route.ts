import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import { handleApiError } from "@/lib/api/errorResponse";
import {
  ALLOWED_SEARCH_MEDIA_KEYS,
  extractAndGuardQueryParams,
  searchMediaSchema,
} from "@/lib/schemas/discoverSearch";

/**
 * Validated API Route for TMDB TV Search.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawParams = extractAndGuardQueryParams(url.searchParams, ALLOWED_SEARCH_MEDIA_KEYS);
    const validated = searchMediaSchema.parse(rawParams);

    const query = validated.q || validated.query;
    const upstreamParams: Record<string, unknown> = {
      query,
      page: validated.page,
      language: validated.language,
      include_adult: validated.include_adult,
    };

    if (validated.year !== undefined) upstreamParams.first_air_date_year = validated.year;

    const { data } = await tmdbApi.get("/search/tv", { params: upstreamParams });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
