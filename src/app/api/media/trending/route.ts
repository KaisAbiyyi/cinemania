import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mendapatkan trending media dari TMDB.
 * Route: /api/trending
 *
 * Parameter query:
 *   - mediaType: "all", "movie", atau "tv"
 *   - timeWindow: "day" atau "week"
 *
 * Contoh request:
 * GET /api/trending?mediaType=movie&timeWindow=day&language=en-US
 */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    // Ambil parameter mediaType dan timeWindow dari query
    const mediaType = searchParams.get("mediaType");
    const timeWindow = searchParams.get("timeWindow");

    // Validasi parameter
    const allowedMediaTypes = ["all", "movie", "tv"];
    const allowedTimeWindows = ["day", "week"];

    if (!mediaType || !allowedMediaTypes.includes(mediaType)) {
        return NextResponse.json(
            { error: "Invalid or missing mediaType parameter. Allowed values: all, movie, tv" },
            { status: 400 }
        );
    }

    if (!timeWindow || !allowedTimeWindows.includes(timeWindow)) {
        return NextResponse.json(
            { error: "Invalid or missing timeWindow parameter. Allowed values: day, week" },
            { status: 400 }
        );
    }

    // Hapus parameter yang sudah diambil agar tidak diteruskan ke TMDB API secara redundan
    searchParams.delete("mediaType");
    searchParams.delete("timeWindow");

    // Konversi sisa query parameters ke object
    const paramsObj = Object.fromEntries(searchParams.entries());

    // Tentukan endpoint TMDB berdasarkan parameter
    const endpoint = `/trending/${mediaType}/${timeWindow}`;

    try {
        const { data } = await tmdbApi.get(endpoint, { params: paramsObj });
        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching trending media:", error);
        return NextResponse.json(
            { error: "Failed to fetch trending media" },
            { status: 500 }
        );
    }
}
