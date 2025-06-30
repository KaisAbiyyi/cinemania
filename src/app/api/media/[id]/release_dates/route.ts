import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mendapatkan release dates dari media.
 * Contoh: /api/media/950387/release_dates?mediaType=movie
 */
export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> }
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

    // Endpoint hanya tersedia untuk 'movie' dan 'tv'
    const endpoint = `/${mediaType}/${id}/release_dates`;

    try {
        const { data } = await tmdbApi.get(endpoint);
        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching release dates:", error);
        return NextResponse.json(
            { error: "Failed to fetch release dates." },
            { status: 500 }
        );
    }
}
