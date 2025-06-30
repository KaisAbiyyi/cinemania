import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

/**
 * API Route untuk mengambil konfigurasi bahasa dari TMDB
 * Contoh request:
 * GET /api/languages
 */
export async function GET() {
    try {
        // Panggil endpoint TMDB /configuration/languages
        const { data } = await tmdbApi.get("/configuration/languages");
        return NextResponse.json(data);
    } catch (error: unknown) {
        console.error("Error fetching languages:", error);
        return NextResponse.json({ error: "Failed to fetch languages" }, { status: 500 });
    }
}
