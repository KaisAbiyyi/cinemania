import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Interface untuk parameter query detail, termasuk id dan mediaType (movie atau tv)
export interface MediaDetailsParams {
    id: number;
    mediaType: "movie" | "tv";
    // Parameter tambahan, misalnya language, dll.
    // eslint-disable-next-line
    [key: string]: any;
}

// Interface untuk struktur response detail media dari TMDB API
// (Untuk keperluan contoh, struktur response diset sebagai any. Kamu bisa menyesuaikannya sesuai kebutuhan.)
export interface MediaDetails {
    // eslint-disable-next-line
    [key: string]: any;
}

/**
 * Hook untuk fetching detail media berdasarkan ID.
 * Contoh penggunaan:
 * GET /api/media/movie_id?mediaType=movie&language=en-US
 */
export const useMediaDetails = (params: MediaDetailsParams) => {
    const { id, ...queryParams } = params;
    return useQuery({
        queryKey: ["mediaDetails", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<MediaDetails>(`/media/${id}`, { params: queryParams });
            return data;
        },
    });
};
