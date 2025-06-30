import { useQuery } from "@tanstack/react-query";

interface YoutubeVideoDetails {
    id: string;
    title: string;
    description: string;
    // eslint-disable-next-line
    thumbnails: any;
    channelTitle: string;
    publishedAt: string;
    duration: string;
    viewCount: string;
}

export function useYoutube(videoId?: string) {
    return useQuery<YoutubeVideoDetails, Error>({
        queryKey: ["youtube-video", videoId],
        queryFn: async () => {
            if (!videoId) throw new Error("No videoId provided");
            const res = await fetch(`/api/youtube?videoId=${videoId}`);
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to fetch YouTube video");
            }
            return res.json();
        },
        enabled: !!videoId,
        staleTime: 1000 * 60 * 10, // 10 minutes
        retry: 1,
    });
}
