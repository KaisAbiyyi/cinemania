import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mendapatkan ulasan dari media.
 * Contoh: /api/media/414906/reviews?mediaType=movie
 */
export async function GET(
    request: Request,
    context: { params: { id: string } | Promise<{ id: string }> }
) {
    const { id } = await context.params;
    const url = new URL(request.url);
    const mediaType = url.searchParams.get("mediaType");

    // Validasi mediaType
    if (!mediaType || (mediaType !== "movie" && mediaType !== "tv")) {
        return NextResponse.json(
            { error: "Invalid or missing mediaType query parameter." },
            { status: 400 }
        );
    }

    // Endpoint untuk mendapatkan ulasan
    const endpoint = `/${mediaType}/${id}/reviews`;

    try {
        const { data } = await tmdbApi.get(endpoint);
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("Error fetching reviews:", error);
        return NextResponse.json(
            { error: "Failed to fetch reviews." },
            { status: 500 }
        );
    }
}
