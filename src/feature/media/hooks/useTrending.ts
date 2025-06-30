import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Interface untuk parameter query trending
export interface TrendingQueryParams {
    mediaType: "all" | "movie" | "tv";
    timeWindow: "day" | "week";
    // Parameter tambahan seperti language, page, dsb.
    // eslint-disable-next-line
    [key: string]: any;
}

// Interface untuk struktur response trending (sesuai response TMDB)
export interface TrendingResponse {
    page: number;
    // eslint-disable-next-line
    results: any[];
    total_pages: number;
    total_results: number;
}

/**
 * Hook untuk fetching trending secara biasa (non-infinite query)
 * Contoh endpoint yang dipanggil: /api/trending?mediaType=movie&timeWindow=day&language=en-US
 */
export const useTrending = (params: TrendingQueryParams) => {
    return useQuery({
        queryKey: ["trending", params],
        queryFn: async () => {
            const { data } = await apiClient.get<TrendingResponse>("/media/trending", { params });
            return data;
        },
    });
};

/**
 * Hook untuk fetching trending dengan infinite query (misalnya untuk infinite scroll)
 */
export const useInfiniteTrending = (params: TrendingQueryParams) => {
    return useInfiniteQuery<TrendingResponse, Error>({
        queryKey: ["trending", params],
        initialPageParam: 1, // halaman awal
        queryFn: async ({ pageParam = 1 }) => {
            const { data } = await apiClient.get<TrendingResponse>("/media/trending", {
                params: { ...params, page: pageParam },
            });
            return data;
        },
        // Menentukan apakah ada halaman selanjutnya berdasarkan TMDB pagination
        getNextPageParam: (lastPage) =>
            lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    });
};
