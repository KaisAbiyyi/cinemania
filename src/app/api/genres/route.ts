import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * Fetch genres from TMDB API using the centralized `tmdbApi.ts`
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (!type || (type !== "movie" && type !== "tv")) {
        return NextResponse.json({ error: "Invalid type parameter" }, { status: 400 });
    }

    try {
        const { data } = await tmdbApi.get(`/genre/${type}/list`);
        return NextResponse.json(data.genres); // Langsung return array genres
    } catch (error) {
        console.error("Error fetching genres:", error);
        return NextResponse.json({ error: "Failed to fetch genres" }, { status: 500 });
    }
}
