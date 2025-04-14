import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export interface MediaKeywordsParams {
    id: number;
    mediaType: "movie" | "tv";
    [key: string]: any;
}

export interface NormalizedKeyword {
    id: number;
    name: string;
    [key: string]: any;
}

export interface NormalizedKeywords {
    id: number;
    keywords: NormalizedKeyword[];
}

/**
 * Hook untuk fetching keywords dari media (movie/tv), dengan normalisasi output agar konsisten.
 */
export const useMediaKeywords = (params: MediaKeywordsParams) => {
    const { id, mediaType, ...queryParams } = params;

    return useQuery<NormalizedKeywords>({
        queryKey: ["mediaKeywords", id, mediaType, queryParams],
        queryFn: async () => {
            const { data } = await apiClient.get(`/media/${id}/keywords`, {
                params: { mediaType, ...queryParams },
            });

            const keywords = mediaType === "movie" ? data.keywords : data.results;

            return {
                id: data.id,
                keywords: Array.isArray(keywords) ? keywords : [],
            };
        },
    });
};
