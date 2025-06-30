import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mendapatkan detail media berdasarkan ID.
 * Harus menyertakan query parameter `mediaType` (movie atau tv).
 */
export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> }
) {
    // Await params sebelum mendestructure
    const { id } = await context.params;
    const url = new URL(request.url);
    const mediaType = url.searchParams.get("mediaType");

    // Validasi query parameter mediaType
    if (!mediaType || (mediaType !== "movie" && mediaType !== "tv")) {
        return NextResponse.json(
            { error: "Invalid mediaType parameter" },
            { status: 400 }
        );
    }

    // Tentukan endpoint berdasarkan mediaType
    const endpoint = mediaType === "movie" ? `/movie/${id}` : `/tv/${id}`;

    try {
        // Konversi searchParams ke object, dan hapus mediaType agar tidak diteruskan ke TMDB API
        const paramsObject = Object.fromEntries(url.searchParams.entries());
        delete paramsObject.mediaType;

        // Fetch data dari TMDB API menggunakan instance tmdbApi
        const { data } = await tmdbApi.get(endpoint, { params: paramsObject });
        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching media details:", error);
        return NextResponse.json(
            { error: "Failed to fetch media details" },
            { status: 500 }
        );
    }
}
