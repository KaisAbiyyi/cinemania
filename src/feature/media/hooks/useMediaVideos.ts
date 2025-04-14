import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Parameter untuk query video, termasuk mediaType (movie atau tv)
export interface MediaVideosParams {
    id: number;
    mediaType: "movie" | "tv";
    [key: string]: any; // Untuk parameter opsional seperti language
}

// Struktur dasar response dari TMDB videos endpoint
export interface MediaVideos {
    id: number;
    results: Array<{
        id: string;
        iso_639_1: string;
        iso_3166_1: string;
        key: string;
        name: string;
        site: string;
        size: number;
        type: string;
        official: boolean;
        published_at: string;
    }>;
}

/**
 * Hook untuk fetching video dari media (movie atau tv).
 * Contoh penggunaan:
 * GET /api/media/12345/videos?mediaType=movie&language=en-US
 */
export const useMediaVideos = (params: MediaVideosParams) => {
    const { id, ...queryParams } = params;

    return useQuery<MediaVideos>({
        queryKey: ["mediaVideos", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<MediaVideos>(`/media/${id}/videos`, {
                params: queryParams,
            });
            return data;
        },
    });
};
