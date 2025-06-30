import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mencari keyword di TMDB
 * Contoh request:
 * GET /api/keywords?query=action&page=1
 *
 * Param:
 * - query (wajib): string pencarian keyword
 * - page (opsional): nomor halaman
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const page = searchParams.get("page") || "1";

    if (!query) {
        return NextResponse.json({ error: "Missing 'query' parameter" }, { status: 400 });
    }

    try {
        // Panggil endpoint TMDB /search/keyword
        const { data } = await tmdbApi.get("/search/keyword", {
            params: {
                query,
                page,
            },
        });

        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching keywords:", error);
        return NextResponse.json({ error: "Failed to fetch keywords" }, { status: 500 });
    }
}
