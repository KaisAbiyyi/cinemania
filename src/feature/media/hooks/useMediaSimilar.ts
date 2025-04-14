import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Parameter untuk query video, termasuk mediaType (movie atau tv)
export interface MediaSimilarParams {
    id: number;
    mediaType: "movie" | "tv";
    [key: string]: any; // Untuk parameter opsional seperti language
}

// Struktur dasar response dari TMDB videos endpoint
export interface MediaSimilar {
    page: number;
    results: any[]
    total_pages: number;
}

/**
 * Hook untuk fetching video dari media (movie atau tv).
 * Contoh penggunaan:
 * GET /api/media/12345/videos?mediaType=movie&language=en-US
 */
export const useMediaSimilar = (params: MediaSimilarParams) => {
    const { id, ...queryParams } = params;

    return useQuery<MediaSimilar>({
        queryKey: ["MediaSimilar", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<MediaSimilar>(`/media/${id}/similar`, {
                params: queryParams,
            });
            return data;
        },
    });
};
