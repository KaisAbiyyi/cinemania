import { useInfiniteQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

type SearchType = "movie" | "tv" | "person" | "keyword";

/**
 * Custom hook for performing searches across different categories (movie, tv, person, keyword).
 * Supports infinite scrolling with React Query's useInfiniteQuery.
 */
export function useSearch(query: string, type: SearchType) {
    return useInfiniteQuery({
        queryKey: ["search", type, query], // Unique key for caching
        queryFn: async ({ pageParam = 1 }) => {
            const { data } = await apiClient.get(`/search/${type}`, {
                params: { q: query, page: pageParam },
            });
            return {
                results: data.results,
                page: data.page,
                total_pages: data.total_pages,
                total_results: data.total_results,
            }; // Ensure response matches API structure
        },
        getNextPageParam: (lastPage) => {
            // Ensure proper pagination handling
            return lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined;
        },
        initialPageParam: 1, // Set the initial page parameter
        enabled: !!query, // Only run query if query string is not empty
    });
}
