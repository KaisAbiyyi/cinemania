import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Parameter untuk query release dates
export interface MediaReleaseDatesParams {
    id: number;
    mediaType: "movie" | "tv";
}

// Struktur dasar response dari TMDB /release_dates endpoint
export interface MediaReleaseDates {
    id: number;
    results: Array<{
        iso_3166_1: string;
        release_dates: Array<{
            certification: string;
            iso_639_1: string;
            release_date: string;
            type: number;
            note: string;
        }>;
    }>;
}

/**
 * Hook untuk fetching release dates dari media.
 * Contoh: /api/media/950387/release_dates?mediaType=movie
 */
export const useMediaReleaseDates = (params: MediaReleaseDatesParams) => {
    const { id, ...queryParams } = params;

    return useQuery({
        queryKey: ["mediaReleaseDates", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<MediaReleaseDates>(`/media/${id}/release_dates`, {
                params: queryParams,
            });
            return data;
        },
    });
};
