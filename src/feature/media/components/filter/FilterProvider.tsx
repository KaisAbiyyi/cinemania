"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, FC } from "react";
import { Filters, globalDefaultFilters } from "@/types/filters";
import { parseQuery } from "@/lib/utils";
import { MediaQueryParams } from "../../hooks/useMedia";

interface FilterContextProps {
    filters: Filters;
    setFilters: (update: Partial<Filters> | ((prev: Filters) => Partial<Filters>)) => void;
    resetFilters: () => void;
    baseDefaultFilters: Filters;
}

interface FilterProviderProps {
    children: ReactNode;
    defaultFilters?: Filters;
}

const FilterContext = createContext<FilterContextProps | undefined>(undefined);

export const FilterProvider: FC<FilterProviderProps> = ({ children, defaultFilters }) => {
    // Gunakan defaultFilters yang dikirimkan, atau globalDefaultFilters
    const baseDefaultFilters: Filters = defaultFilters ?? globalDefaultFilters;

    // Inisialisasi state dengan base default
    const [filters, setFiltersState] = useState<Filters>(baseDefaultFilters);

    // Di client, gabungkan base default dengan URL filter
    useEffect(() => {
        if (typeof window !== "undefined") {
            const parsedQuery = parseQuery(window.location.search);
            const merged = { ...baseDefaultFilters, ...parsedQuery };
            setFiltersState(merged);
        }
    }, [baseDefaultFilters]);

    const setFilters = (update: Partial<Filters> | ((prev: Filters) => Partial<Filters>)) => {
        setFiltersState((prev) => {
            const updateObj = typeof update === "function" ? update(prev) : update;
            return { ...prev, ...updateObj };
        });
    };

    // Reset mengembalikan ke base default, tanpa merge URL
    const resetFilters = () => {
        setFiltersState(baseDefaultFilters);
    };

    return (
        <FilterContext.Provider value={{ filters, setFilters, resetFilters, baseDefaultFilters }}>
            {children}
        </FilterContext.Provider>
    );
};

export const useFilterContext = (): FilterContextProps => {
    const context = useContext(FilterContext);
    if (!context) {
        throw new Error("useFilterContext must be used within a FilterProvider");
    }
    return context;
};

// Fungsi bantu untuk convert filter → query param
export const buildMediaQueryParams = (
    mediaType: "movie" | "tv",
    filters: Filters
): MediaQueryParams => {
    return {
        mediaType,
        sort_by: filters.sort_by || "popularity.desc",
        "release_date.gte": filters.release_date_gte || "",
        "release_date.lte": filters.release_date_lte || "",
        "first_air_date.gte": filters.first_air_date_gte || "",
        "first_air_date.lte": filters.first_air_date_lte || "",
        "air_date.gte": filters.air_date_gte || "",
        "air_date.lte": filters.air_date_lte || "",
        with_genres: filters.with_genres || "",
        "vote_average.gte": filters.vote_average_gte || 0,
        "vote_average.lte": filters.vote_average_lte || 10,
        "vote_count.gte": filters.vote_count_gte || 0,
        "with_runtime.gte": filters.with_runtime_gte || 0,
        "with_runtime.lte": filters.with_runtime_lte || 360,
        with_release_type: filters.with_release_type || "",
        without_genres: filters.without_genres || "",
        with_keywords: filters.with_keywords || "",
        with_original_language: filters.with_original_language || "",
        watch_region: filters.watch_region || "US",
        with_watch_providers: filters.with_watch_providers || "",
    };
};
