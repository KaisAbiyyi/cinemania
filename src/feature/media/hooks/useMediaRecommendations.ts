import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Parameter untuk query video, termasuk mediaType (movie atau tv)
export interface MediaRecommendationsParams {
    id: number;
    mediaType: "movie" | "tv";
    // eslint-disable-next-line
    [key: string]: any; // Untuk parameter opsional seperti language
}

// Struktur dasar response dari TMDB videos endpoint
export interface MediaRecommendations {
    page: number;
    // eslint-disable-next-line
    results: any[]
    total_pages: number;
}

/**
 * Hook untuk fetching video dari media (movie atau tv).
 * Contoh penggunaan:
 * GET /api/media/12345/videos?mediaType=movie&language=en-US
 */
export const useMediaRecommendations = (params: MediaRecommendationsParams) => {
    const { id, ...queryParams } = params;

    return useQuery<MediaRecommendations>({
        queryKey: ["MediaRecommendations", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<MediaRecommendations>(`/media/${id}/recommendations`, {
                params: queryParams,
            });
            return data;
        },
    });
};
