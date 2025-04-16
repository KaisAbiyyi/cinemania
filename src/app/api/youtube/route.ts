import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

// Rate limiting setup
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();

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
                { status: 429 }
            );
        }

        // Extract query parameters
        const { searchParams } = new URL(request.url);
        const videoId = searchParams.get("videoId");

        if (!videoId) {
            return NextResponse.json({ error: "Missing videoId parameter" }, { status: 400 });
        }

        // Fetch YouTube video data
        const youtubeApiKey = process.env.YOUTUBE_API_KEY;
        if (!youtubeApiKey) {
            return NextResponse.json(
                { error: "Server configuration error" },
                { status: 500 }
            );
        }

        const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoId}&key=${youtubeApiKey}`;

        const response = await fetch(youtubeApiUrl, {
            next: { revalidate: 3600 } // Cache for 1 hour
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to fetch video data" },
                { status: response.status }
            );
        }

        const data = await response.json();

        // Return simplified video details
        if (data.items && data.items.length > 0) {
            const videoDetails = {
                id: data.items[0].id,
                title: data.items[0].snippet.title,
                description: data.items[0].snippet.description,
                thumbnails: data.items[0].snippet.thumbnails,
                channelTitle: data.items[0].snippet.channelTitle,
                publishedAt: data.items[0].snippet.publishedAt,
                duration: data.items[0].contentDetails.duration,
                viewCount: data.items[0].statistics.viewCount,
            };

            return NextResponse.json(videoDetails);
        } else {
            return NextResponse.json({ error: "Video not found" }, { status: 404 });
        }

    } catch (error) {
        console.error("Error fetching YouTube video:", error);
        return NextResponse.json({ error: "Failed to fetch video data" }, { status: 500 });
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
