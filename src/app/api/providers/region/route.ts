import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { cachedServerFetch, jsonWithCachePolicy } from "@/lib/server/cache/serverCache";

/**
 * API Route untuk mengambil provider region dari TMDB
 * Contoh request:
 * GET /api/watch/providers/regions?language=en-US
 */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const language = url.searchParams.get("language") || "en-US";

    try {
        const policy = ENDPOINT_CACHE_POLICIES.providers_region;
        const { data, cacheStatus } = await cachedServerFetch(
            policy,
            { language },
            async () => {
                const res = await tmdbApi.get("/watch/providers/regions", {
                    params: { language },
                });
                return res.data;
            }
        );
        return jsonWithCachePolicy(data, policy, cacheStatus);
    } catch (error: unknown) {
        console.error("Error fetching provider regions:", error);
        return NextResponse.json(
            { error: "Failed to fetch provider regions" },
            { status: 500, headers: { "Cache-Control": "no-store" } }
        );
    }
}
