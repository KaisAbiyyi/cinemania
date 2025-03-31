"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export interface Keyword {
    id: number;
    name: string;
}

export interface KeywordResponse {
    page: number;
    results: Keyword[];
    total_pages: number;
    total_results: number;
}

export interface KeywordQueryParams {
    query: string;  // Query for searching
    page?: number;  // Optional page number
    fetchAll?: boolean; // New option to force fetch regardless of query
}

/**
 * Hook untuk mencari keyword ke route /api/keywords
 */
export const useKeywordsSearch = (params: KeywordQueryParams, options = {}) => {
    const { query, fetchAll = false, ...restParams } = params;

    return useQuery({
        queryKey: ["keywords", { query, ...restParams }],
        queryFn: async () => {
            const { data } = await apiClient.get<KeywordResponse>("/keywords", {
                params: { query, ...restParams },
            });
            return data;
        },
        // Enable fetch if query exists OR if fetchAll is true
        enabled: !!query || fetchAll,
        ...options
    });
};