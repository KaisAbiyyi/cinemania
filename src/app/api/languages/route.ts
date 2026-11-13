import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { cachedServerFetch, jsonWithCachePolicy } from "@/lib/server/cache/serverCache";

/**
 * API Route untuk mengambil konfigurasi bahasa dari TMDB
 * Contoh request:
 * GET /api/languages
 */
export async function GET() {
    try {
        const policy = ENDPOINT_CACHE_POLICIES.languages;
        const { data, cacheStatus } = await cachedServerFetch(
            policy,
            {},
            async () => {
                const res = await tmdbApi.get("/configuration/languages");
                return res.data;
            }
        );
        return jsonWithCachePolicy(data, policy, cacheStatus);
    } catch (error: unknown) {
        console.error("Error fetching languages:", error);
        return NextResponse.json(
            { error: "Failed to fetch languages" },
            { status: 500, headers: { "Cache-Control": "no-store" } }
        );
    }
}
