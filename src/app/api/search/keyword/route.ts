import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import { handleApiError } from "@/lib/api/errorResponse";
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

    const { data } = await tmdbApi.get("/search/keyword", { params: upstreamParams });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
