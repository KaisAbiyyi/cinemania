import { z } from "zod";
import { ValidationError } from "@/lib/api/errorResponse";

// Bounded input security constants
export const MAX_PARAM_KEY_LENGTH = 40;
export const MAX_PARAM_VALUE_LENGTH = 300;
export const MAX_TOTAL_PARAMS = 25;
export const MAX_REPEATED_PARAM_COUNT = 1;

// Injection and protocol guard patterns
const DISALLOWED_URL_PATTERN = /(?:https?:\/\/|ftp:\/\/|javascript:|data:|\/\/)/i;
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

/**
 * Validates low-level query parameter constraints:
 * - Bounds total count of parameters
 * - Detects duplicate / repeated query keys
 * - Blocks arbitrary non-whitelisted parameter keys
 * - Enforces key and value length bounds
 * - Blocks URL scheme injection and unprintable control characters
 */
export function extractAndGuardQueryParams(
  searchParams: URLSearchParams,
  allowedKeys: Set<string>
): Record<string, string> {
  const keysSeen = new Map<string, number>();
  const totalEntries = Array.from(searchParams.entries());

  if (totalEntries.length > MAX_TOTAL_PARAMS) {
    throw new ValidationError(
      `Too many query parameters. Maximum allowed is ${MAX_TOTAL_PARAMS}, received ${totalEntries.length}.`
    );
  }

  for (const [key, value] of totalEntries) {
    if (key.length > MAX_PARAM_KEY_LENGTH) {
      throw new ValidationError(`Query parameter key exceeds max length of ${MAX_PARAM_KEY_LENGTH}: "${key.slice(0, 20)}..."`);
    }

    if (value.length > MAX_PARAM_VALUE_LENGTH) {
      throw new ValidationError(`Value for parameter "${key}" exceeds max length of ${MAX_PARAM_VALUE_LENGTH}.`);
    }

    if (CONTROL_CHAR_PATTERN.test(key) || CONTROL_CHAR_PATTERN.test(value)) {
      throw new ValidationError(`Parameter "${key}" contains disallowed control characters.`);
    }

    if (DISALLOWED_URL_PATTERN.test(value)) {
      throw new ValidationError(`Parameter "${key}" contains disallowed URL or protocol scheme.`);
    }

    const currentCount = (keysSeen.get(key) || 0) + 1;
    if (currentCount > MAX_REPEATED_PARAM_COUNT) {
      throw new ValidationError(`Duplicate parameter "${key}" is not allowed.`);
    }
    keysSeen.set(key, currentCount);

    if (!allowedKeys.has(key)) {
      throw new ValidationError(`Unrecognized query parameter "${key}". Arbitrary parameters are rejected.`);
    }
  }

  // Convert to plain key-value object
  const result: Record<string, string> = {};
  for (const [key, value] of totalEntries) {
    result[key] = value;
  }
  return result;
}

// Allowed sort values for TMDB discover endpoint
export const ALLOWED_SORT_VALUES = [
  "popularity.asc",
  "popularity.desc",
  "revenue.asc",
  "revenue.desc",
  "primary_release_date.asc",
  "primary_release_date.desc",
  "release_date.asc",
  "release_date.desc",
  "vote_average.asc",
  "vote_average.desc",
  "vote_count.asc",
  "vote_count.desc",
  "first_air_date.asc",
  "first_air_date.desc",
  "title.asc",
  "title.desc",
  "original_title.asc",
  "original_title.desc",
] as const;

// Common helper schemas
const booleanString = z.preprocess((val) => {
  if (val === "true" || val === true) return true;
  if (val === "false" || val === false) return false;
  return val;
}, z.boolean({ invalid_type_error: "Must be a valid boolean ('true' or 'false')" }));

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format, expected YYYY-MM-DD");
const idListString = z.string().regex(/^(\d+[|,])*\d+$/, "Expected comma or pipe-separated integer IDs").max(200);

export const ALLOWED_DISCOVER_KEYS = new Set([
  "mediaType",
  "page",
  "include_adult",
  "language",
  "sort_by",
  "release_date.gte",
  "release_date.lte",
  "first_air_date.gte",
  "first_air_date.lte",
  "air_date.gte",
  "air_date.lte",
  "primary_release_date.gte",
  "primary_release_date.lte",
  "vote_average.gte",
  "vote_average.lte",
  "vote_count.gte",
  "vote_count.lte",
  "with_runtime.gte",
  "with_runtime.lte",
  "with_genres",
  "without_genres",
  "with_keywords",
  "without_keywords",
  "with_watch_providers",
  "watch_region",
  "with_original_language",
  "with_release_type",
  "year",
  "primary_release_year",
]);

export const discoverMediaSchema = z
  .object({
    mediaType: z.enum(["movie", "tv"], {
      errorMap: () => ({ message: "Invalid or missing mediaType parameter. Allowed values: movie, tv" }),
    }),
    page: z.coerce.number().int("Page must be an integer").min(1, "Page must be at least 1").max(500, "Page must not exceed 500").default(1),
    include_adult: booleanString.default(false),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Invalid language code format (e.g. en-US)").default("en-US"),
    sort_by: z.enum(ALLOWED_SORT_VALUES).optional(),
    "release_date.gte": dateString.optional(),
    "release_date.lte": dateString.optional(),
    "first_air_date.gte": dateString.optional(),
    "first_air_date.lte": dateString.optional(),
    "air_date.gte": dateString.optional(),
    "air_date.lte": dateString.optional(),
    "primary_release_date.gte": dateString.optional(),
    "primary_release_date.lte": dateString.optional(),
    "vote_average.gte": z.coerce.number().min(0, "vote_average.gte must be >= 0").max(10, "vote_average.gte must be <= 10").optional(),
    "vote_average.lte": z.coerce.number().min(0, "vote_average.lte must be >= 0").max(10, "vote_average.lte must be <= 10").optional(),
    "vote_count.gte": z.coerce.number().int().min(0).max(1000000).optional(),
    "vote_count.lte": z.coerce.number().int().min(0).max(1000000).optional(),
    "with_runtime.gte": z.coerce.number().int().min(0).max(1440).optional(),
    "with_runtime.lte": z.coerce.number().int().min(0).max(1440).optional(),
    with_genres: idListString.optional(),
    without_genres: idListString.optional(),
    with_keywords: idListString.optional(),
    without_keywords: idListString.optional(),
    with_watch_providers: idListString.optional(),
    watch_region: z.string().regex(/^[A-Z]{2}$/, "Invalid watch_region, expected 2-letter uppercase ISO country code").optional(),
    with_original_language: z.string().regex(/^[a-z]{2}$/, "Invalid with_original_language, expected 2-letter lowercase ISO code").optional(),
    with_release_type: z.string().regex(/^([1-6][|,])*[1-6]$/, "Expected with_release_type integers 1-6 separated by pipe or comma").optional(),
    year: z.coerce.number().int().min(1870).max(2100).optional(),
    primary_release_year: z.coerce.number().int().min(1870).max(2100).optional(),
  })
  .refine(
    (data) => {
      if (data["vote_average.gte"] !== undefined && data["vote_average.lte"] !== undefined) {
        return data["vote_average.lte"] >= data["vote_average.gte"];
      }
      return true;
    },
    { message: "vote_average.lte must be greater than or equal to vote_average.gte", path: ["vote_average.lte"] }
  )
  .refine(
    (data) => {
      if (data["vote_count.gte"] !== undefined && data["vote_count.lte"] !== undefined) {
        return data["vote_count.lte"] >= data["vote_count.gte"];
      }
      return true;
    },
    { message: "vote_count.lte must be greater than or equal to vote_count.gte", path: ["vote_count.lte"] }
  )
  .refine(
    (data) => {
      if (data["with_runtime.gte"] !== undefined && data["with_runtime.lte"] !== undefined) {
        return data["with_runtime.lte"] >= data["with_runtime.gte"];
      }
      return true;
    },
    { message: "with_runtime.lte must be greater than or equal to with_runtime.gte", path: ["with_runtime.lte"] }
  )
  .refine(
    (data) => {
      if (data["release_date.gte"] && data["release_date.lte"]) {
        return data["release_date.lte"] >= data["release_date.gte"];
      }
      return true;
    },
    { message: "release_date.lte must be on or after release_date.gte", path: ["release_date.lte"] }
  )
  .refine(
    (data) => {
      if (data["first_air_date.gte"] && data["first_air_date.lte"]) {
        return data["first_air_date.lte"] >= data["first_air_date.gte"];
      }
      return true;
    },
    { message: "first_air_date.lte must be on or after first_air_date.gte", path: ["first_air_date.lte"] }
  );

export type ValidatedDiscoverMedia = z.infer<typeof discoverMediaSchema>;

export const ALLOWED_TRENDING_KEYS = new Set(["mediaType", "timeWindow", "page", "language"]);

export const trendingMediaSchema = z.object({
  mediaType: z.enum(["all", "movie", "tv"], {
    errorMap: () => ({ message: "Invalid or missing mediaType parameter. Allowed values: all, movie, tv" }),
  }),
  timeWindow: z.enum(["day", "week"], {
    errorMap: () => ({ message: "Invalid or missing timeWindow parameter. Allowed values: day, week" }),
  }),
  page: z.coerce.number().int().min(1).max(500).default(1),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Invalid language code format (e.g. en-US)").default("en-US"),
});

export type ValidatedTrendingMedia = z.infer<typeof trendingMediaSchema>;

export const ALLOWED_SEARCH_MEDIA_KEYS = new Set([
  "q",
  "query",
  "page",
  "language",
  "include_adult",
  "year",
  "primary_release_year",
]);

export const searchMediaSchema = z
  .object({
    q: z.string().trim().min(1, "Search query must not be empty").max(200, "Search query must not exceed 200 characters").optional(),
    query: z.string().trim().min(1, "Search query must not be empty").max(200, "Search query must not exceed 200 characters").optional(),
    page: z.coerce.number().int().min(1, "Page must be at least 1").max(500, "Page must not exceed 500").default(1),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Invalid language code format (e.g. en-US)").default("en-US"),
    include_adult: booleanString.default(false),
    year: z.coerce.number().int().min(1870).max(2100).optional(),
    primary_release_year: z.coerce.number().int().min(1870).max(2100).optional(),
  })
  .refine((data) => Boolean(data.q || data.query), {
    message: "Query parameter 'q' or 'query' is required",
    path: ["q"],
  });

export type ValidatedSearchMedia = z.infer<typeof searchMediaSchema>;

export const ALLOWED_SEARCH_KEYWORD_KEYS = new Set(["q", "query", "page"]);

export const searchKeywordSchema = z
  .object({
    q: z.string().trim().min(1, "Search query must not be empty").max(200, "Search query must not exceed 200 characters").optional(),
    query: z.string().trim().min(1, "Search query must not be empty").max(200, "Search query must not exceed 200 characters").optional(),
    page: z.coerce.number().int().min(1, "Page must be at least 1").max(500, "Page must not exceed 500").default(1),
  })
  .refine((data) => Boolean(data.q || data.query), {
    message: "Query parameter 'q' or 'query' is required",
    path: ["q"],
  });

export type ValidatedSearchKeyword = z.infer<typeof searchKeywordSchema>;
