import { useQuery } from "@tanstack/react-query";
import { fetchMovieDetail, fetchMovieCredits, fetchMovieRecommendations } from "@/services/movieService";

/**
 * Custom hook untuk fetch detail movie, cast, dan rekomendasi
 * @param {string} detailType - "movie" atau "tv"
 * @param {number} id - ID dari movie atau TV show
 * @param {boolean} includeCredits - Apakah ingin fetch data cast & crew?
 * @param {boolean} includeRecommendations - Apakah ingin fetch rekomendasi?
 * @returns {Object} - { movieDetail, credits, recommendations, isLoading, error }
 */
export const useMovieDetail = (detailType: string, id: number, includeCredits = false, includeRecommendations = false) => {
    const movieDetailQuery = useQuery({
        queryKey: [`movieDetail-${detailType}`, id],
        queryFn: async () => {
            const movie = await fetchMovieDetail(detailType, id);
            return movie;
        },
        staleTime: 60 * 1000, // Cache data selama 1 menit
    });

    const movieCreditsQuery = useQuery({
        queryKey: [`movieCredits-${detailType}`, id],
        queryFn: async () => {
            const credits = await fetchMovieCredits(detailType, id);
            return credits;
        },
        enabled: includeCredits, // Hanya fetch jika `includeCredits === true`
        staleTime: 60 * 1000,
    });

    const movieRecommendationsQuery = useQuery({
        queryKey: [`movieRecommendations-${detailType}`, id],
        queryFn: async () => {
            const recommendations = await fetchMovieRecommendations(detailType, id);
            return recommendations;
        },
        enabled: includeRecommendations, // Hanya fetch jika `includeRecommendations === true`
        staleTime: 60 * 1000,
    });

    return {
        movieDetail: movieDetailQuery.data,
        credits: movieCreditsQuery.data,
        recommendations: movieRecommendationsQuery.data,
        isLoading: movieDetailQuery.isLoading,
        error: movieDetailQuery.error,
    };
};
