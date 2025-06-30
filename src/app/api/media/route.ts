import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mengakses TMDB Discover Endpoint secara fleksibel
 * Mendukung kedua mediaType: "movie" dan "tv"
 * Semua query parameter selain `mediaType` akan diteruskan ke TMDB API.
 *
 * Contoh request:
 * GET /api/media?mediaType=movie&include_adult=false&language=en-US&page=1&sort_by=popularity.desc
 */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    // Ambil parameter pembeda media (movie atau tv)
    const mediaType = searchParams.get("mediaType");
    if (!mediaType || (mediaType !== "movie" && mediaType !== "tv")) {
        return NextResponse.json({ error: "Invalid mediaType parameter" }, { status: 400 });
    }

    // Hapus mediaType dari parameter agar tidak diteruskan ke TMDB
    searchParams.delete("mediaType");

    // Tentukan endpoint berdasarkan mediaType
    const endpoint = mediaType === "movie" ? "/discover/movie" : "/discover/tv";

    try {
        // Konversi searchParams ke object untuk diteruskan sebagai params
        const params = Object.fromEntries(searchParams.entries());

        // Fetch data dari TMDB API menggunakan tmdbApi instance
        const { data } = await tmdbApi.get(endpoint, { params });

        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching media:", error);
        return NextResponse.json({ error: "Failed to fetch media" }, { status: 500 });
    }
}
