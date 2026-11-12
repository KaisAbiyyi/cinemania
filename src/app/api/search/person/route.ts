import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import { handleApiError } from "@/lib/api/errorResponse";
import {
  ALLOWED_SEARCH_PERSON_KEYS,
  extractAndGuardQueryParams,
  searchPersonSchema,
} from "@/lib/schemas/discoverSearch";

/**
 * Validated API Route for TMDB Person Search.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawParams = extractAndGuardQueryParams(url.searchParams, ALLOWED_SEARCH_PERSON_KEYS);
    const validated = searchPersonSchema.parse(rawParams);

    const query = (validated.q || validated.query)!;
    const upstreamParams: Record<string, unknown> = {
      query,
      page: validated.page,
      language: validated.language,
      include_adult: validated.include_adult,
    };

    const { data } = await tmdbApi.get("/search/person", { params: upstreamParams });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
