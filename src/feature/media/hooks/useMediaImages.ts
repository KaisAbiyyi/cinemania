import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Parameter untuk query video, termasuk mediaType (movie atau tv)
export interface MediaImagesParams {
    id: number;
    mediaType: "movie" | "tv";
    [key: string]: any; // Untuk parameter opsional seperti language
}

// Struktur dasar response dari TMDB videos endpoint
export interface MediaImages {
    backdrops: Array<{
        file_path: string;
        aspect_ratio: number;
        height: number;
        iso_639_1: string;
        vote_average: number;
        vote_count: number;
        width: number;
    }>,
    logos: Array<{
        file_path: string;
        aspect_ratio: number;
        height: number;
        iso_639_1: string;
        vote_average: number;
        vote_count: number;
        width: number;
    }>,
    posters: Array<{
        file_path: string;
        aspect_ratio: number;
        height: number;
        iso_639_1: string;
        vote_average: number;
        vote_count: number;
        width: number;
    }>,
}

/**
 * Hook untuk fetching video dari media (movie atau tv).
 * Contoh penggunaan:
 * GET /api/media/12345/videos?mediaType=movie&language=en-US
 */
export const useMediaImages = (params: MediaImagesParams) => {
    const { id, ...queryParams } = params;

    return useQuery<MediaImages>({
        queryKey: ["MediaImages", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<MediaImages>(`/media/${id}/images`, {
                params: queryParams,
            });
            return data;
        },
    });
};
