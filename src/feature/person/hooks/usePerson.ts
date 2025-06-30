import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Interface untuk parameter query detail person, termasuk id dan parameter tambahan
export interface PersonDetailsParams {
    id: number;
    // eslint-disable-next-line
    [key: string]: any;
}

// Interface untuk struktur response detail person dari TMDB API
// (Untuk keperluan contoh, struktur response diset sebagai any. Kamu bisa menyesuaikannya sesuai kebutuhan.)
export interface PersonDetails {
    // eslint-disable-next-line
    [key: string]: any;
}

/**
 * Hook untuk fetching detail person berdasarkan ID.
 * Contoh penggunaan:
 * GET /api/person/person_id
 */
export const usePerson = (params: PersonDetailsParams) => {
    const { id, ...queryParams } = params;
    return useQuery({
        queryKey: ["personDetails", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<PersonDetails>(`/person/${id}`, { params: queryParams });
            return data;
        },
    });
};
