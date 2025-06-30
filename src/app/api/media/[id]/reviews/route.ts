import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mendapatkan ulasan dari media.
 * Contoh: /api/media/414906/reviews?mediaType=movie
 */
export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    // Ambil parameter mediaType
    const mediaType = searchParams.get("mediaType");
    if (!mediaType || (mediaType !== "movie" && mediaType !== "tv")) {
        return NextResponse.json(
            { error: "Invalid or missing mediaType query parameter." },
            { status: 400 }
        );
    }

    // Hapus mediaType dari parameter agar tidak diteruskan ke TMDB
    searchParams.delete("mediaType");

    // Tentukan endpoint berdasarkan mediaType dan id
    const endpoint = `/${mediaType}/${id}/reviews`;

    try {
        // Konversi searchParams ke object untuk diteruskan sebagai params
        const params = Object.fromEntries(searchParams.entries());

        // Fetch data dari TMDB API menggunakan tmdbApi instance
        const { data } = await tmdbApi.get(endpoint, { params });

        // Kembalikan hanya data
        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching reviews:", error);
        return NextResponse.json(
            { error: "Failed to fetch reviews." },
            { status: 500 }
        );
    }
}
