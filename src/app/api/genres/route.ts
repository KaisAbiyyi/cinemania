import { NextResponse } from "next/server";

const API_RAT = process.env.TMDB_API_RAT; // Gunakan `process.env` di Next.js
const BASE_URL = "https://api.themoviedb.org/3";

/**
 * Fetch genres list from TMDB API
 * Supports both Movies and TV Shows genres
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // Ambil query param `type`

    if (!type || (type !== "movie" && type !== "tv")) {
        return NextResponse.json({ error: "Invalid type parameter" }, { status: 400 });
    }

    try {
        const res = await fetch(`${BASE_URL}/genre/${type}/list`, {
            headers: {
                Authorization: `Bearer ${API_RAT}`,
                Accept: "application/json",
            },
        });

        if (!res.ok) throw new Error("Failed to fetch genres");

        const data = await res.json();
        return NextResponse.json(data.genres); // Hanya kirim array genres
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
    }
}
