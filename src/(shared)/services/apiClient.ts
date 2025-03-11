import axios from "axios";

const apiClient = axios.create({
    baseURL: "/api", // Semua request akan otomatis memakai prefix `/api`
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 10000, // 10 detik timeout agar tidak hanging
});

export default apiClient;
