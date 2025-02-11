import { useQuery } from "@tanstack/react-query";
import { fetchGenres } from "../services/genreService";

/**
 * Custom Hook for fetching genres
 * @param {"movie" | "tv"} type - Genre type (movie or tv)
 * @returns {UseQueryResult<Genre[], Error>}
 */
export const useGenres = (type: "movie" | "tv") => {
    return useQuery({
        queryKey: ["genres", type],
        queryFn: () => fetchGenres(type),
    });
};
