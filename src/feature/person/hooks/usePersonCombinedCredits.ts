import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Interface untuk parameter query combined credits, termasuk id dan parameter tambahan
export interface PersonCombinedCreditsParams {
    id: number;
    [key: string]: any;
}

// Interface untuk struktur response combined credits dari TMDB API
// (Untuk keperluan contoh, struktur response diset sebagai any. Kamu bisa menyesuaikannya sesuai kebutuhan.)
export interface PersonCombinedCredits {
    cast: any[];
    crew: any[];
}

/**
 * Hook untuk fetching combined credits person berdasarkan ID.
 * Contoh penggunaan:
 * GET /api/person/person_id/combined_credits
 */
export const usePersonCombinedCredits = (params: PersonCombinedCreditsParams) => {
    const { id, ...queryParams } = params;
    return useQuery({
        queryKey: ["personCombinedCredits", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<PersonCombinedCredits>(`/person/${id}/combined_credits`, { params: queryParams });
            return data;
        },
    });
};
