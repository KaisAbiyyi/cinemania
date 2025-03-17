import { useQuery } from "@tanstack/react-query";
import apiClient from "../../../services/apiClient";

/**
 * Custom Hook for fetching genres via API Route (Axios version)
 */
export const useGenres = (type: "movie" | "tv") => {
    return useQuery({
        queryKey: ["genres", type],
        queryFn: async () => {
            const { data } = await apiClient.get(`/genres`, { params: { type } });
            return data;
        },
    });
};
