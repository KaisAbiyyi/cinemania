import axios from "axios";

const TMDB_API_KEY = process.env.TMDB_API_RAT;
const BASE_URL = "https://api.themoviedb.org/3";

// Konfigurasi Axios khusus untuk TMDB API
const tmdbApi = axios.create({
    baseURL: BASE_URL,
    headers: {
        Authorization: `Bearer ${TMDB_API_KEY}`,
        Accept: "application/json",
    },
    timeout: 10000, // 10 detik timeout agar tidak hanging
});

export default tmdbApi;
