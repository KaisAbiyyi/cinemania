import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Parameter untuk query credits, termasuk mediaType (movie atau tv)
export interface MediaCreditsParams {
    id: number;
    mediaType: "movie" | "tv";
    // eslint-disable-next-line
    [key: string]: any; // Untuk parameter opsional seperti language
}

// Struktur dasar response dari TMDB credits endpoint
export interface MediaCredits {
    id: number;
    cast: Array<{
        id: number;
        name: string;
        character: string;
        profile_path: string | null;
        order: number;
        // eslint-disable-next-line
        [key: string]: any;
    }>;
    crew: Array<{
        id: number;
        name: string;
        job: string;
        department: string;
        profile_path: string | null;
        // eslint-disable-next-line
        [key: string]: any;
    }>;
}

/**
 * Hook untuk fetching credits dari media (cast & crew).
 * Contoh penggunaan:
 * GET /api/media/12345/credits?mediaType=movie&language=en-US
 */
export const useMediaCredits = (params: MediaCreditsParams) => {
    const { id, ...queryParams } = params;

    return useQuery({
        queryKey: ["mediaCredits", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<MediaCredits>(`/media/${id}/credits`, {
                params: queryParams,
            });
            return data;
        },
    });
};
