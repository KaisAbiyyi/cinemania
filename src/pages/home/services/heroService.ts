import axios from "axios";

const API_RAT = import.meta.env.VITE_TMDB_API_RAT; // Ambil API Key dari .env
const BASE_URL = "https://api.themoviedb.org/3";

/**
 * Fetch trending movies (daily)
 * @returns {Promise<Movie[]>} List of trending movies
 */
export const fetchTrendingMovies = async () => {
    const response = await axios.get(`${BASE_URL}/trending/all/day`, {
        headers: {
            Authorization: `Bearer ${API_RAT}`,
            Accept: 'application/json'
        }
    });

    return response.data.results; // Ambil array movies dari response
};
