import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mendapatkan video dari film tertentu.
 * Diperlukan query parameter `mediaType` dengan nilai `movie` atau `tv`.
 * Contoh: /api/media/950387/videos?mediaType=movie
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

    // Buat endpoint berdasarkan mediaType
    const endpoint = `/${mediaType}/${id}/similar`;

    try {
        // Ambil sisa query string selain mediaType (misalnya language)
        const paramsObject = Object.fromEntries(url.searchParams.entries());
        delete paramsObject.mediaType;

        // Fetch data dari TMDB API
        const { data } = await tmdbApi.get(endpoint, { params: paramsObject });

        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching media similar:", error);
        return NextResponse.json(
            { error: "Failed to fetch media similar." },
            { status: 500 }
        );
    }
}
