// src/types/filters.ts
export interface Filters {
    [key: string]: string | number | undefined;
    sort_by?: string;
    release_date_gte?: string;
    release_date_lte?: string;
    first_air_date_gte?: string;
    air_date_gte?: string;
    air_date_lte?: string;
    first_air_date_lte?: string;
    vote_average_gte?: number;
    vote_average_lte?: number;
    vote_count_gte?: number;
    with_runtime_gte?: number;
    with_runtime_lte?: number;
    with_genres?: string;
    with_keywords?: string;
    with_original_language?: string;
    watch_region?: string;
    with_watch_providers?: string;
    with_release_type?: string;
}

export const globalDefaultFilters: Filters = {
    sort_by: "popularity.desc",
    release_date_gte: "",
    release_date_lte: "",
    first_air_date_gte: "",
    air_date_gte: "",
    air_date_lte: "",
    first_air_date_lte: "",
    vote_average_gte: 0,
    vote_average_lte: 10,
    vote_count_gte: 0,
    with_runtime_gte: 0,
    with_runtime_lte: 360,
    with_genres: "",
    with_keywords: "",
    with_original_language: "en",
    watch_region: "",
    with_watch_providers: "",
    with_release_type: ""
};
