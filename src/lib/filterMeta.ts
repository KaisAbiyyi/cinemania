import { Filters } from "@/types/filters";

// lib/filterMeta.ts
export const filterFieldTypes: Record<keyof Filters, "string" | "number"> = {
    sort_by: "string",
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
