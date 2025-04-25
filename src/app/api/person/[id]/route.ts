import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mendapatkan detail person berdasarkan ID.
 */
export async function GET(
    request: Request,
    context: { params: { id: string } | Promise<{ id: string }> }
) {
    // Await params sebelum mendestructure
    const { id } = await context.params;

    try {
        // Fetch data dari TMDB API menggunakan instance tmdbApi
        const { data } = await tmdbApi.get(`/person/${id}`);
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("Error fetching person details:", error);
        return NextResponse.json(
            { error: "Failed to fetch person details" },
            { status: 500 }
        );
    }
}
