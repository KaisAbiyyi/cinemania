"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export interface ProviderRegion {
    iso_3166_1: string;
    english_name: string;
    native_name: string;
}

export interface ProviderRegionsResponse {
    results: ProviderRegion[];
}

/**
 * Hook untuk mengambil provider region dari endpoint /api/providers/region
 *
 * Parameter:
 * - language: bahasa, default "en-US"
 * - options: opsional, React Query options
 */
export const useProviderRegions = (
    language: string = "en-US",
    options = {}
) => {
    return useQuery({
        queryKey: ["providerRegions", language],
        queryFn: async () => {
            // Memanggil /api/providers/region dengan parameter language
            const { data } = await apiClient.get<ProviderRegionsResponse>("/providers/region", {
                params: { language },
            });
            return data;
        },
        enabled: !!language,
        ...options,
    });
};
