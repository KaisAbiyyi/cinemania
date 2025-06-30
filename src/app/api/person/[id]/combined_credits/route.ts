import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mendapatkan combined credits dari person berdasarkan ID.
 */
export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> }
) {
    // Await params sebelum mendestructure
    const { id } = await context.params;

    try {
        // Fetch data dari TMDB API menggunakan instance tmdbApi
        const { data } = await tmdbApi.get(`/person/${id}/combined_credits`);
        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching combined credits:", error);
        return NextResponse.json(
            { error: "Failed to fetch combined credits." },
            { status: 500 }
        );
    }
}
