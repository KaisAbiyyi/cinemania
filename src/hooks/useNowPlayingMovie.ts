import { useQuery } from "@tanstack/react-query";
import { fetchNowPlayingMovie } from "../services/movieService";

/**
 * Custom hook untuk mendapatkan daftar popular movies
 */
export const useNowPlayingMovie = () => {
    return useQuery({
        queryKey: ["nowPlayingMovie"],
        queryFn: async () => {
            const nowPlaying = await fetchNowPlayingMovie()
            return nowPlaying
        },
    });
};
