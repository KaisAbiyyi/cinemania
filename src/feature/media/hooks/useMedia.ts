import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Interface untuk parameter query, misalnya mediaType dan filter lainnya
export interface MediaQueryParams {
    mediaType: "movie" | "tv";
    // Parameter tambahan filtering, paging, sorting, dll
    // eslint-disable-next-line
    [key: string]: any;
}

// Interface untuk struktur response dari TMDB API
export interface MediaResponse {
    page: number;
    // eslint-disable-next-line
    results: any[];
    total_pages: number;
    total_results: number;
}

export interface MediaHookOptions {
    enabled?: boolean;
}

/**
 * Hook untuk fetching media biasa (non-infinite query)
 */
export const useMedia = (params: MediaQueryParams, options?: MediaHookOptions) => {
    return useQuery({
        queryKey: ["media", params],
        enabled: options?.enabled ?? true,
        queryFn: async () => {
            const { data } = await apiClient.get<MediaResponse>("/media", { params });
            return data;
        },
    });
};

/**
 * Hook untuk fetching media dengan infinite query (infinite scroll)
 */
export const useInfiniteMedia = (params: MediaQueryParams, options?: MediaHookOptions) => {
    return useInfiniteQuery<MediaResponse, Error>({
        queryKey: ["media", params],
        enabled: options?.enabled ?? true,
        initialPageParam: 1, // Menentukan halaman awal
        queryFn: async ({ pageParam = 1 }) => {
            const { data } = await apiClient.get<MediaResponse>("/media", {
                params: { ...params, page: pageParam },
            });
            return data;
        },
        // Menggunakan data pagination dari TMDB untuk menentukan apakah ada halaman selanjutnya
        getNextPageParam: (lastPage) => {
            return lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined;
        },
    });
};
