"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export interface GeolocationResponse {
    region: string;
}

/**
 * Hook untuk mengambil geolokasi dari endpoint /api/geolocation
 * Menggunakan axios melalui apiClient dan menerima parameter options untuk penyesuaian React Query.
 */
export const useGeolocation = (options = {}) => {
    return useQuery<GeolocationResponse, Error>({
        queryKey: ["geolocation"],
        queryFn: async () => {
            const { data } = await apiClient.get<GeolocationResponse>("/geolocation");
            console.log(data)
            return data;
        },
        ...options,
    });
};
