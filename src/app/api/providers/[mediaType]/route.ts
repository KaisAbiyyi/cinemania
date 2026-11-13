import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import {
    cacheConcurrencyLimitResponse,
    cachedServerFetch,
    jsonWithCachePolicy,
} from "@/lib/server/cache/serverCache";

/**
 * API Route untuk mengambil provider media dari TMDB berdasarkan mediaType.
 * Contoh request:
 * GET /api/watch/providers/movie?language=en-US&watch_region=US
 * GET /api/watch/providers/tv?language=en-US&watch_region=US
 *
 * Parameter:
 * - mediaType: "movie" atau "tv"
 * - language: optional, default "en-US"
 * - watch_region: optional, misal "US"
 */
export async function GET(
    request: Request,
    context: { params: Promise<{ mediaType: string }> }
) {
    // Pastikan params sudah di-resolve sebelum digunakan.
    const { mediaType } = await context.params;
    const url = new URL(request.url);
    const language = url.searchParams.get("language") || "en-US";
    const watchRegion = url.searchParams.get("watch_region") || "";

    if (!mediaType || (mediaType !== "movie" && mediaType !== "tv")) {
        return NextResponse.json(
            { error: "Invalid mediaType parameter" },
            { status: 400, headers: { "Cache-Control": "no-store" } }
        );
    }

    try {
        const policy = ENDPOINT_CACHE_POLICIES.providers_media;
        const { data, cacheStatus } = await cachedServerFetch(
            policy,
            { mediaType, language, watch_region: watchRegion },
            async () => {
                const res = await tmdbApi.get(`/watch/providers/${mediaType}`, {
                    params: {
                        language,
                        watch_region: watchRegion,
                    },
                });
                return res.data;
            }
        );
        return jsonWithCachePolicy(data, policy, cacheStatus);
    } catch (error: unknown) {
        const overloadResponse = cacheConcurrencyLimitResponse(error);
        if (overloadResponse) {
            return overloadResponse;
        }
        console.error("Error fetching provider media:", error);
        return NextResponse.json(
            { error: "Failed to fetch provider media" },
            { status: 500, headers: { "Cache-Control": "no-store" } }
        );
    }
}