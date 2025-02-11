import { useQuery } from "@tanstack/react-query";
import { fetchPopular } from "../services/movieService";

/**
 * Custom hook untuk mendapatkan daftar popular movies
 */
export const usePopular = (detailType: string) => {
    return useQuery({
        queryKey: ["popular", detailType],
        queryFn: async () => {
            const popular = await fetchPopular(detailType)
            return popular
        },
    });
};
