import { Filters, TvDateMode } from "@/types/filters";

export const DATE_FILTER_KEYS = [
    "release_date_gte",
    "release_date_lte",
    "air_date_gte",
    "air_date_lte",
    "first_air_date_gte",
    "first_air_date_lte",
] as const;

export const DATE_FILTER_KEY_SET: ReadonlySet<string> = new Set(DATE_FILTER_KEYS);

export function normalizeTvDateMode(value: unknown): TvDateMode | undefined {
    return value === "air_date" || value === "first_air_date" ? value : undefined;
}

// lib/filterMeta.ts
export const filterFieldTypes: Record<keyof Filters, "string" | "number"> = {
    sort_by: "string",
    dateMode: "string",
    release_date_gte: "string",
    release_date_lte: "string",
    first_air_date_gte: "string",
    first_air_date_lte: "string",
    air_date_gte: "string",
    air_date_lte: "string",
    with_genres: "string",
    vote_average_gte: "number",
    vote_average_lte: "number",
    vote_count_gte: "number",
    with_runtime_gte: "number",
    with_runtime_lte: "number",
    with_release_type: "string",
    without_genres: "string",
    with_keywords: "string",
    with_original_language: "string",
    watch_region: "string",
    with_watch_providers: "string",
};
