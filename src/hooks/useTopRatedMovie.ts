import { useQuery } from "@tanstack/react-query";
import { fetchTopRatedMovie } from "../services/movieService";

/**
 * Custom hook untuk mendapatkan daftar popular movies
 */
export const useTopRatedMovie = () => {
    return useQuery({
        queryKey: ["topRatedMovie"],
        queryFn: async () => {
            const topRated = await fetchTopRatedMovie()
            return topRated
        },
    });
};
