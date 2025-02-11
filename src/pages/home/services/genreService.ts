import axios from "axios";

const API_RAT = import.meta.env.VITE_TMDB_API_RAT; // Ambil API Key dari .env
const BASE_URL = "https://api.themoviedb.org/3";

/**
 * Fetch genres list for Movies or TV Shows
 * @param { "movie" | "tv" } type - Type of genres to fetch (movie or tv)
 * @returns {Promise<Genre[]>} List of genres
 */
export const fetchGenres = async (type: "movie" | "tv") => {
    const response = await axios.get(`${BASE_URL}/genre/${type}/list`, {
        headers: {
            Authorization: `Bearer ${API_RAT}`,
            Accept: "application/json",
        },
    });

    return response.data.genres; // Ambil array genre dari response
};
