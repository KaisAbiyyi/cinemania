import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { cachedServerFetch, jsonWithCachePolicy } from "@/lib/server/cache/serverCache";

/**
 * Fetch genres from TMDB API using the centralized `tmdbApi.ts`
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (!type || (type !== "movie" && type !== "tv")) {
        return NextResponse.json(
            { error: "Invalid type parameter" },
            { status: 400, headers: { "Cache-Control": "no-store" } }
        );
    }

    try {
        const policy = ENDPOINT_CACHE_POLICIES.genres;
        const { data, cacheStatus } = await cachedServerFetch(
            policy,
            { type },
            async () => {
                const res = await tmdbApi.get(`/genre/${type}/list`);
                return res.data.genres;
            }
        );
        return jsonWithCachePolicy(data, policy, cacheStatus);
    } catch (error) {
        console.error("Error fetching genres:", error);
        return NextResponse.json(
            { error: "Failed to fetch genres" },
            { status: 500, headers: { "Cache-Control": "no-store" } }
        );
    }
}
