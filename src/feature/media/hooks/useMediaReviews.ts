import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

// Parameter untuk query reviews, termasuk mediaType (movie atau tv)
export interface MediaReviewsParams {
    id: number;
    mediaType: "movie" | "tv";
    language?: string;
    page?: number;
}

// Struktur dasar response dari TMDB reviews endpoint
export interface Review {
    author: string;
    author_details: {
        name?: string;
        username: string;
        avatar_path?: string;
        rating?: number;
    };
    content: string;
    created_at: string;
    id: string;
    updated_at: string;
    url: string;
}

export interface MediaReviews {
    id: number;
    page: number;
    results: Review[];
    total_pages: number;
    total_results: number;
}

/**
 * Hook untuk fetching reviews dari media (movie atau tv).
 * Contoh penggunaan:
 * GET /media/12345/reviews?mediaType=movie&language=en-US&page=1
 */
export const useMediaReviews = (params: MediaReviewsParams) => {
    const { id, mediaType, language = "en-US", page = 1 } = params;

    return useQuery<MediaReviews>({
        queryKey: ["mediaReviews", id, mediaType, language, page],
        queryFn: async () => {
            const { data } = await apiClient.get<MediaReviews>(`/media/${id}/reviews`, {
                params: { mediaType, language, page },
            });
            return data;
        },
    });
};

/**
 * Hook untuk fetching reviews dari media (movie atau tv) dengan infinite query.
 * Contoh penggunaan:
 * GET /media/12345/reviews?mediaType=movie&language=en-US&page=1
 */
export const useInfiniteMediaReviews = (params: MediaReviewsParams) => {
    const { id, mediaType, language = "en-US" } = params;

    return useInfiniteQuery<MediaReviews, Error>({
        queryKey: ["mediaReviews", id, mediaType, language],
        initialPageParam: 1, // Halaman awal
        queryFn: async ({ pageParam = 1 }) => {
            const { data } = await apiClient.get<MediaReviews>(`/media/${id}/reviews`, {
                params: { mediaType, language, page: pageParam },
            });
            return data;
        },
        // Menentukan halaman berikutnya berdasarkan data pagination dari TMDB
        getNextPageParam: (lastPage) => {
            return lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined;
        },
    });
};
