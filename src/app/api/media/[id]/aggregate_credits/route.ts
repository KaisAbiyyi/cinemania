import { NextResponse } from "next/server";
import tmdbApi from "@/services/tmdbApi";

export async function GET(
    request: Request,
    context: { params: { id: string } | Promise<{ id: string }> }
) {
    const { id } = await context.params;
    const endpoint = `/tv/${id}/aggregate_credits`;

    try {
        const { data } = await tmdbApi.get(endpoint);
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("Error fetching TV aggregate credits:", error);
        return NextResponse.json(
            { error: "Failed to fetch TV aggregate credits." },
            { status: 500 }
        );
    }
}
