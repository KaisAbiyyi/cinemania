"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export interface ProviderMediaResponse {
    // Sesuaikan dengan struktur respons TMDB
    // eslint-disable-next-line
    results?: any;
    // eslint-disable-next-line
    [key: string]: any;
}

/**
 * Hook untuk mengambil provider media berdasarkan mediaType,
 * language, dan watch_region.
 *
 * Contoh penggunaan:
 * const { data, isLoading } = useProviderMedia("movie", "en-US", "US");
 */
export const useProviderMedia = (
    mediaType: "movie" | "tv",
    language: string = "en-US",
    watchRegion?: string,
    options = {}
) => {
    return useQuery({
        queryKey: ["providerMedia", mediaType, language, watchRegion],
        queryFn: async () => {
            const { data } = await apiClient.get<ProviderMediaResponse>(
                `/providers/${mediaType}`,
                {
                    params: {
                        language,
                        watch_region: watchRegion,
                    },
                }
            );
            return data;
        },
        enabled: !!mediaType,
        ...options,
    });
};
