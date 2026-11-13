import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { ENDPOINT_CACHE_POLICIES } from "@/lib/server/cache/cachePolicies";
import { cachedServerFetch, jsonWithCachePolicy } from "@/lib/server/cache/serverCache";

// Rate limiting setup
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();

class YoutubeUpstreamError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export async function GET(request: NextRequest) {
    try {
        // Get client IP for rate limiting
        const headersList = await headers();
        const forwardedFor = headersList.get("x-forwarded-for") || "unknown";
        const clientIp = forwardedFor.split(",")[0].trim();

        // Check rate limit
        if (!isRateLimitOk(clientIp)) {
            return NextResponse.json(
                { error: "Too many requests, please try again later" },
                { status: 429, headers: { "Cache-Control": "no-store" } }
            );
        }

        // Extract query parameters
        const { searchParams } = new URL(request.url);
        const videoId = searchParams.get("videoId");

        if (!videoId) {
            return NextResponse.json(
                { error: "Missing videoId parameter" },
                { status: 400, headers: { "Cache-Control": "no-store" } }
            );
        }

        // Fetch YouTube video data
        const youtubeApiKey = process.env.YOUTUBE_API_KEY;
        if (!youtubeApiKey) {
            return NextResponse.json(
                { error: "Server configuration error" },
                { status: 500, headers: { "Cache-Control": "no-store" } }
            );
        }

        const policy = ENDPOINT_CACHE_POLICIES.youtube_video;
        const { data: videoDetails, cacheStatus } = await cachedServerFetch(
            policy,
            { videoId },
            async () => {
                const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(videoId)}&key=${youtubeApiKey}`;
                const response = await fetch(youtubeApiUrl);

                if (!response.ok) {
                    throw new YoutubeUpstreamError(response.status, "Failed to fetch video data");
                }

                const data = await response.json();
                if (!data.items || data.items.length === 0) {
                    throw new YoutubeUpstreamError(404, "Video not found");
                }

                return {
                    id: data.items[0].id,
                    title: data.items[0].snippet.title,
                    description: data.items[0].snippet.description,
                    thumbnails: data.items[0].snippet.thumbnails,
                    channelTitle: data.items[0].snippet.channelTitle,
                    publishedAt: data.items[0].snippet.publishedAt,
                    duration: data.items[0].contentDetails.duration,
                    viewCount: data.items[0].statistics.viewCount,
                };
            }
        );

        return jsonWithCachePolicy(videoDetails, policy, cacheStatus);
    } catch (error) {
        if (error instanceof YoutubeUpstreamError) {
            return NextResponse.json(
                { error: error.message },
                { status: error.status, headers: { "Cache-Control": "no-store" } }
            );
        }
        console.error("Error fetching YouTube video:", error);
        return NextResponse.json(
            { error: "Failed to fetch video data" },
            { status: 500, headers: { "Cache-Control": "no-store" } }
        );
    }
}

// Rate limiting function
function isRateLimitOk(clientIp: string): boolean {
    const now = Date.now();
    const clientData = ipRequestCounts.get(clientIp);

    if (!clientData) {
        // First request from this IP
        ipRequestCounts.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return true;
    }

    if (now > clientData.resetTime) {
        // Reset window has passed
        ipRequestCounts.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return true;
    }

    if (clientData.count < MAX_REQUESTS_PER_WINDOW) {
        // Increment count
        clientData.count += 1;
        ipRequestCounts.set(clientIp, clientData);
        return true;
    }

    // Rate limit exceeded
    return false;
}
