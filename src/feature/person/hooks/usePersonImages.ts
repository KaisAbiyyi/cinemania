import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Interface untuk parameter query images person, termasuk id dan parameter tambahan
export interface PersonImagesParams {
    id: number;
    [key: string]: any;
}

// Interface untuk struktur response images dari TMDB API
// (Untuk keperluan contoh, struktur response diset sebagai any. Kamu bisa menyesuaikannya sesuai kebutuhan.)
export interface PersonImages {
    profiles: any[];
}

/**
 * Hook untuk fetching images person berdasarkan ID.
 * Contoh penggunaan:
 * GET /api/person/person_id/images
 */
export const usePersonImages = (params: PersonImagesParams) => {
    const { id, ...queryParams } = params;
    return useQuery({
        queryKey: ["personImages", id, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get<PersonImages>(`/person/${id}/images`, { params: queryParams });
            return data;
        },
    });
};
