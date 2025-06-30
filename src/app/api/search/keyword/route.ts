import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mencari film berdasarkan query.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query) {
        return NextResponse.json(
            { error: "Query parameter 'q' is required" },
            { status: 400 }
        );
    }

    try {
        // Fetch data dari TMDB API menggunakan instance tmdbApi
        const { data } = await tmdbApi.get(`/search/tv`, {
            params: { query },
        });
        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching tv search results:", error);
        return NextResponse.json(
            { error: "Failed to fetch tv search results" },
            { status: 500 }
        );
    }
}
