import { useQuery } from "@tanstack/react-query";
import { fetchUpcomingMovie } from "../services/movieService";

/**
 * Custom hook untuk mendapatkan daftar popular movies
 */
export const useUpcomingMovie = () => {
    return useQuery({
        queryKey: ["upcomingMovie"],
        queryFn: async () => {
            const upcoming = await fetchUpcomingMovie()
            return upcoming
        },
    });
};
