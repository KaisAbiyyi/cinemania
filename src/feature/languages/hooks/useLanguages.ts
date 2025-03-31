"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export interface Language {
    iso_639_1: string;
    english_name: string;
    name: string;
}

/**
 * Hook untuk mengambil daftar bahasa dari route /api/languages
 */
export const useLanguages = (options = {}) => {
    return useQuery({
        queryKey: ["languages"],
        queryFn: async () => {
            const { data } = await apiClient.get<Language[]>("/languages");
            return data;
        },
        enabled: true,
        ...options,
    });
};
