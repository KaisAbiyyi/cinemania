import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Parameter untuk query aggregate credits, termasuk mediaType (hanya tv)
export interface MediaAggregateCreditsParams {
    id: number;
    enabled?: boolean; // Untuk mengontrol apakah query diaktifkan atau tidak
    // eslint-disable-next-line
    [key: string]: any; // Untuk parameter opsional seperti language
}

// Struktur dasar response dari TMDB aggregate credits endpoint
export interface MediaAggregateCredits {
    id: number;
    cast: Array<{
        id: number;
        name: string;
        roles: Array<{
            character: string;
            episode_count: number;
        }>;
        profile_path: string | null;
        // eslint-disable-next-line
        [key: string]: any;
    }>;
    crew: Array<{
        id: number;
        name: string;
        jobs: Array<{
            job: string;
            episode_count: number;
        }>;
        department: string;
        profile_path: string | null;
        // eslint-disable-next-line
        [key: string]: any;
    }>;
}

/**
 * Hook untuk fetching aggregate credits dari TV media.
 * Contoh penggunaan:
 * GET /api/media/12345/aggregate_credits?language=en-US
 */
export const useMediaAggregateCredits = (params: MediaAggregateCreditsParams) => {
    const { id, ...queryParams } = params;

    return useQuery({
        queryKey: ["mediaAggregateCredits", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<MediaAggregateCredits>(`/media/${id}/aggregate_credits`, {
                params: queryParams,
            });
            return data;
        },
        enabled: params.enabled !== false, // Hanya aktifkan query jika enabled tidak false

    });
};
