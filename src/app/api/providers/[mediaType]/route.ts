import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mengambil provider media dari TMDB berdasarkan mediaType.
 * Contoh request:
 * GET /api/watch/providers/movie?language=en-US&watch_region=US
 * GET /api/watch/providers/tv?language=en-US&watch_region=US
 *
 * Parameter:
 * - mediaType: "movie" atau "tv"
 * - language: optional, default "en-US"
 * - watch_region: optional, misal "US"
 */
export async function GET(
    request: Request,
    context: { params: { mediaType: string } }
) {
    // Pastikan params sudah di-resolve sebelum digunakan.
    const { mediaType } = await Promise.resolve(context.params);
    const url = new URL(request.url);
    const language = url.searchParams.get("language") || "en-US";
    const watchRegion = url.searchParams.get("watch_region") || "";

    if (!mediaType || (mediaType !== "movie" && mediaType !== "tv")) {
        return NextResponse.json(
            { error: "Invalid mediaType parameter" },
            { status: 400 }
        );
    }

    try {
        // Kirim language dan watch_region ke endpoint TMDB
        const { data } = await tmdbApi.get(`/watch/providers/${mediaType}`, {
            params: {
                language,
                watch_region: watchRegion,
            },
        });
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("Error fetching provider media:", error);
        return NextResponse.json(
            { error: "Failed to fetch provider media" },
            { status: 500 }
        );
    }
}
