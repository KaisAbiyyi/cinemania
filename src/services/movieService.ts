import axios from "axios";

const API_BASE_URL = "https://api.themoviedb.org/3";
const API_TOKEN = import.meta.env.VITE_TMDB_API_RAT;

/**
 * Generic function untuk fetch data dari TMDB API
 * @param {string} endpoint - Endpoint TMDB (tanpa base URL)
 * @param {Record<string, any>} params - Query parameters untuk API
 * @returns {Promise<any>} - Data dari TMDB API
 */
export const fetchFromTMDB = async (endpoint: string, params: Record<string, any> = {}) => {
    const { data } = await axios.get(`${API_BASE_URL}/${endpoint}`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
        params,
    });
    return data;
};

/**
 * Fetch detail movie atau TV show berdasarkan ID
 * @param {string} detailType - "movie" atau "tv"
 * @param {number} id - ID dari movie atau tv show
 * @returns {Promise<any>} - Data detail movie/TV show dari TMDB
 */
export const fetchMovieDetail = (detailType: string, id: number) => {
    return fetchFromTMDB(`${detailType}/${id}`);
};

/**
 * Fetch cast & crew dari movie atau TV show
 * @param {string} detailType - "movie" atau "tv"
 * @param {number} id - ID dari movie atau TV show
 * @returns {Promise<any>} - Data cast & crew
 */
export const fetchMovieCredits = (detailType: string, id: number) => {
    return fetchFromTMDB(`${detailType}/${id}/credits`);
};

/**
 * Fetch rekomendasi berdasarkan movie atau TV show
 * @param {string} detailType - "movie" atau "tv"
 * @param {number} id - ID dari movie atau TV show
 * @returns {Promise<any>} - Data rekomendasi dari TMDB
 */
export const fetchMovieRecommendations = (detailType: string, id: number) => {
    return fetchFromTMDB(`${detailType}/${id}/recommendations`);
};

/**
 * Fetch daftar popular movies
 * @returns {Promise<any>} - List of popular movies dari TMDB
 */
export const fetchPopular = (detailType:string) => {
    console.log(detailType)
    return fetchFromTMDB(`discover/${detailType}`, {
        include_adult: false,
        language: "en-US",
        page: 1,
        sort_by: "popularity.desc",
    });
};
