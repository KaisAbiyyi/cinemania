import { useQuery } from "@tanstack/react-query";
import { fetchTrendingMovies } from "@/pages/home/services/heroService";

/**
 * Custom hook untuk mendapatkan 5 trending movies (Hero Section)
 * @returns {Object} { data, isLoading, error }
 */
export const useHeroMovies = () => {
    return useQuery({
        queryKey: ["trendingMovies"],
        queryFn: async () => {
            const movies = await fetchTrendingMovies();
            return movies.slice(0, 5); // Hanya ambil 5 film pertama (index 0-4)
        },
        staleTime: 60 * 1000, // Cache data selama 1 menit
    });
};
