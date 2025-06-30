"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Filters } from "@/types/filters";

// Fungsi helper untuk mengonversi nilai string ke tipe default (number atau string)
function parseValue<T>(defaultValue: T, value: string): T {
    return (typeof defaultValue === "number" ? Number(value) : value) as T;
}

export const useFilterSync = (defaults: Filters) => {
    const router = useRouter();
    const searchParams = useSearchParams();

    const getInitialFilters = (): Filters => {
        const filters: Filters = { ...defaults };
        (Object.keys(filters) as (keyof Filters)[]).forEach((key) => {
            const param = searchParams.get(key as string);
            if (param !== null) {
                // Jika ada nilai di URL, parsing jika default sudah terdefinisi
                filters[key] =
                    // eslint-disable-next-line
                    defaults[key] !== undefined ? parseValue(defaults[key] as any, param) : param;
            }
        });
        return filters;
    };

    const updateUrl = (filters: Filters) => {
        const queryParams = new URLSearchParams();

        (Object.keys(filters) as (keyof Filters)[]).forEach((key) => {
            const filterValue = filters[key];
            const defaultValue = defaults[key];

            // Hanya set key jika filterValue ada dan berbeda dari default.
            if (
                filterValue !== undefined &&
                filterValue !== null &&
                filterValue !== "" &&
                String(filterValue) !== String(defaultValue ?? "")
            ) {
                queryParams.set(key as string, String(filterValue));
            }
        });

        const queryString = queryParams.toString();
        const newUrl = queryString ? `?${queryString}` : window.location.pathname;
        router.push(newUrl);
    };

    return { getInitialFilters, updateUrl };
};
