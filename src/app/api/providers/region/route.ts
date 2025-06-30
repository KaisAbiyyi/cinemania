import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mengambil provider region dari TMDB
 * Contoh request:
 * GET /api/watch/providers/regions?language=en-US
 */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const language = url.searchParams.get("language") || "en-US";

    try {
        const { data } = await tmdbApi.get("/watch/providers/regions", {
            params: { language },
        });
        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching provider regions:", error);
        return NextResponse.json(
            { error: "Failed to fetch provider regions" },
            { status: 500 }
        );
    }
}
