// hooks/useTVContentRatings.ts
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export type TVContentRatingsResponse = {
    results: Array<{
        iso_3166_1: string;
        rating: string;
    }>;
}

export const useTVContentRatings = (id: number) => {
    return useQuery({
        queryKey: ["tvContentRatings", id],
        queryFn: async () => {
            const { data } = await apiClient.get<TVContentRatingsResponse>(`/media/${id}/content_ratings`);
            return data;
        },
    });
};
