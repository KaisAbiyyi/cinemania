import { z } from "zod";
import { ValidationError } from "@/lib/api/errorResponse";
import {
  ALLOWED_MOVIE_SORT_VALUES,
  CONTROL_CHAR_PATTERN,
  DISALLOWED_URL_PATTERN,
  MAX_PARAM_KEY_LENGTH,
  MAX_PARAM_VALUE_LENGTH,
  booleanString,
  calendarDateString,
  idListString,
} from "@/lib/schemas/discoverSearch";

export const DEFAULT_ROOM_DECK_LANGUAGE = "en-US";
export const DEFAULT_ROOM_DECK_SORT = "popularity.desc" as const;
export const MAX_DECK_FILTER_KEYS = 25;
export const MAX_DECK_FILTER_JSON_BYTES = 2048;

export const ALLOWED_ROOM_DECK_FILTER_KEYS = new Set<string>([
  "include_adult",
  "language",
  "sort_by",
  "release_date.gte",
  "release_date.lte",
  "primary_release_date.gte",
  "primary_release_date.lte",
  "primary_release_year",
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
]);

const FILTER_KEY_ALIASES: Record<string, string> = {
  include_adults: "include_adult",
  release_date_gte: "release_date.gte",
  release_date_lte: "release_date.lte",
  primary_release_date_gte: "primary_release_date.gte",
  primary_release_date_lte: "primary_release_date.lte",
  vote_average_gte: "vote_average.gte",
  vote_average_lte: "vote_average.lte",
  vote_count_gte: "vote_count.gte",
  vote_count_lte: "vote_count.lte",
  with_runtime_gte: "with_runtime.gte",
  with_runtime_lte: "with_runtime.lte",
};

const DISALLOWED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const releaseTypeListString = z
  .string()
  .regex(/^([1-6][|,])*[1-6]$/, "Expected with_release_type integers 1-6 separated by pipe or comma")
  .max(40);

export const roomDeckFilterSchema = z
  .object({
    include_adult: booleanString.default(false),
    language: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Invalid language code format (e.g. en-US)")
      .default(DEFAULT_ROOM_DECK_LANGUAGE),
    sort_by: z.enum(ALLOWED_MOVIE_SORT_VALUES).default(DEFAULT_ROOM_DECK_SORT),
    "release_date.gte": calendarDateString.optional(),
    "release_date.lte": calendarDateString.optional(),
    "primary_release_date.gte": calendarDateString.optional(),
    "primary_release_date.lte": calendarDateString.optional(),
    primary_release_year: z.coerce
      .number()
      .int("primary_release_year must be an integer")
      .min(1870, "primary_release_year must be >= 1870")
      .max(2100, "primary_release_year must be <= 2100")
      .optional(),
    "vote_average.gte": z.coerce
      .number()
      .min(0, "vote_average.gte must be >= 0")
      .max(10, "vote_average.gte must be <= 10")
      .optional(),
    "vote_average.lte": z.coerce
      .number()
      .min(0, "vote_average.lte must be >= 0")
      .max(10, "vote_average.lte must be <= 10")
      .optional(),
    "vote_count.gte": z.coerce
      .number()
      .int("vote_count.gte must be an integer")
      .min(0, "vote_count.gte must be >= 0")
      .max(1_000_000, "vote_count.gte must be <= 1000000")
      .optional(),
    "vote_count.lte": z.coerce
      .number()
      .int("vote_count.lte must be an integer")
      .min(0, "vote_count.lte must be >= 0")
      .max(1_000_000, "vote_count.lte must be <= 1000000")
      .optional(),
    "with_runtime.gte": z.coerce
      .number()
      .int("with_runtime.gte must be an integer")
      .min(0, "with_runtime.gte must be >= 0")
      .max(1440, "with_runtime.gte must be <= 1440")
      .optional(),
    "with_runtime.lte": z.coerce
      .number()
      .int("with_runtime.lte must be an integer")
      .min(0, "with_runtime.lte must be >= 0")
      .max(1440, "with_runtime.lte must be <= 1440")
      .optional(),
    with_genres: idListString.optional(),
    without_genres: idListString.optional(),
    with_keywords: idListString.optional(),
    without_keywords: idListString.optional(),
    with_watch_providers: idListString.optional(),
    watch_region: z
      .string()
      .regex(/^[A-Z]{2}$/, "Invalid watch_region, expected 2-letter uppercase ISO country code")
      .optional(),
    with_original_language: z
      .string()
      .regex(/^[a-z]{2}$/, "Invalid with_original_language, expected 2-letter lowercase ISO code")
      .optional(),
    with_release_type: releaseTypeListString.optional(),
  })
  .strict()
  .refine((data) => data.include_adult === false, {
    message: "Adult content is disallowed in CineMatch room decks (include_adult must be false).",
    path: ["include_adult"],
  })
  .refine(
    (data) => {
      if (data["vote_average.gte"] !== undefined && data["vote_average.lte"] !== undefined) {
        return data["vote_average.lte"] >= data["vote_average.gte"];
      }
      return true;
    },
    {
      message: "vote_average.lte must be greater than or equal to vote_average.gte",
      path: ["vote_average.lte"],
    }
  )
  .refine(
    (data) => {
      if (data["vote_count.gte"] !== undefined && data["vote_count.lte"] !== undefined) {
        return data["vote_count.lte"] >= data["vote_count.gte"];
      }
      return true;
    },
    {
      message: "vote_count.lte must be greater than or equal to vote_count.gte",
      path: ["vote_count.lte"],
    }
  )
  .refine(
    (data) => {
      if (data["with_runtime.gte"] !== undefined && data["with_runtime.lte"] !== undefined) {
        return data["with_runtime.lte"] >= data["with_runtime.gte"];
      }
      return true;
    },
    {
      message: "with_runtime.lte must be greater than or equal to with_runtime.gte",
      path: ["with_runtime.lte"],
    }
  )
  .refine(
    (data) => {
      if (data["release_date.gte"] && data["release_date.lte"]) {
        return data["release_date.lte"] >= data["release_date.gte"];
      }
      return true;
    },
    {
      message: "release_date.lte must be on or after release_date.gte",
      path: ["release_date.lte"],
    }
  )
  .refine(
    (data) => {
      if (data["primary_release_date.gte"] && data["primary_release_date.lte"]) {
        return data["primary_release_date.lte"] >= data["primary_release_date.gte"];
      }
      return true;
    },
    {
      message: "primary_release_date.lte must be on or after primary_release_date.gte",
      path: ["primary_release_date.lte"],
    }
  )
  .refine(
    (data) => {
      if (data.with_watch_providers && !data.watch_region) {
        return false;
      }
      return true;
    },
    {
      message: "watch_region is required when with_watch_providers is specified.",
      path: ["watch_region"],
    }
  );

export type CanonicalRoomDeckFilter = z.infer<typeof roomDeckFilterSchema>;

export const DEFAULT_ROOM_DECK_FILTER: CanonicalRoomDeckFilter = Object.freeze({
  include_adult: false,
  language: DEFAULT_ROOM_DECK_LANGUAGE,
  sort_by: DEFAULT_ROOM_DECK_SORT,
});

export interface SafeDeckCandidate {
  candidateId: string;
  position: number;
  movieId: number;
  title: string;
  posterPath: string | null;
  posterUrl: string | null;
  overview: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertSafeFilterScalar(key: string, value: unknown): string | number | boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    if (CONTROL_CHAR_PATTERN.test(value)) {
      throw new ValidationError(`Deck filter '${key}' contains disallowed control characters.`);
    }
    const trimmed = value.trim();
    if (trimmed === "") {
      return undefined;
    }
    if (trimmed.length > MAX_PARAM_VALUE_LENGTH) {
      throw new ValidationError(
        `Deck filter '${key}' exceeds max length of ${MAX_PARAM_VALUE_LENGTH}.`
      );
    }
    if (DISALLOWED_URL_PATTERN.test(trimmed)) {
      throw new ValidationError(`Deck filter '${key}' contains disallowed URL or protocol scheme.`);
    }
    return trimmed;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`Deck filter '${key}' must be a finite number.`);
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw new ValidationError(`Deck filter '${key}' must be a string, number, or boolean.`);
}

function canonicalizeObjectKeys(parsed: CanonicalRoomDeckFilter): CanonicalRoomDeckFilter {
  const sortedEntries = Object.entries(parsed)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));

  const out: Record<string, unknown> = {};
  for (const [k, v] of sortedEntries) {
    out[k] = v;
  }
  // Explicit safety invariants always present
  out.include_adult = false;
  if (!out.language) out.language = DEFAULT_ROOM_DECK_LANGUAGE;
  if (!out.sort_by) out.sort_by = DEFAULT_ROOM_DECK_SORT;

  const resorted: Record<string, unknown> = {};
  for (const key of Object.keys(out).sort((a, b) => a.localeCompare(b))) {
    resorted[key] = out[key];
  }
  return resorted as CanonicalRoomDeckFilter;
}

/**
 * Validates and canonicalizes a room common movie deck filter object.
 * Enforces strict movie-only TMDB discover allowlist, non-adult invariant (`include_adult: false`),
 * bounded strings/counts, and deterministic sorted-key JSON canonicalization.
 */
export function normalizeRoomDeckFilter(rawInput: unknown): CanonicalRoomDeckFilter {
  if (rawInput === undefined || rawInput === null) {
    return { ...DEFAULT_ROOM_DECK_FILTER };
  }
  if (!isPlainObject(rawInput)) {
    throw new ValidationError("Room deck filter payload must be a JSON object.");
  }

  let serializedSize = 0;
  try {
    serializedSize = Buffer.byteLength(JSON.stringify(rawInput), "utf8");
  } catch {
    throw new ValidationError("Room deck filter payload is not serializable.");
  }
  if (serializedSize > MAX_DECK_FILTER_JSON_BYTES) {
    throw new ValidationError(
      `Room deck filter payload exceeds maximum size of ${MAX_DECK_FILTER_JSON_BYTES} bytes.`
    );
  }

  const keys = Object.keys(rawInput);
  if (keys.length > MAX_DECK_FILTER_KEYS) {
    throw new ValidationError(
      `Too many deck filter fields. Maximum allowed is ${MAX_DECK_FILTER_KEYS}.`
    );
  }

  const normalized: Record<string, unknown> = {};
  for (const rawKey of keys) {
    if (
      DISALLOWED_OBJECT_KEYS.has(rawKey) ||
      CONTROL_CHAR_PATTERN.test(rawKey) ||
      rawKey.length > MAX_PARAM_KEY_LENGTH
    ) {
      throw new ValidationError("Deck filter contains an invalid or disallowed field name.");
    }

    const canonicalKey = FILTER_KEY_ALIASES[rawKey] ?? rawKey;
    if (!ALLOWED_ROOM_DECK_FILTER_KEYS.has(canonicalKey)) {
      throw new ValidationError(
        `Unrecognized or unsupported movie deck filter '${rawKey}'.`
      );
    }

    const safeVal = assertSafeFilterScalar(rawKey, rawInput[rawKey]);
    if (safeVal === undefined) {
      continue;
    }

    if (
      Object.prototype.hasOwnProperty.call(normalized, canonicalKey) &&
      String(normalized[canonicalKey]) !== String(safeVal)
    ) {
      throw new ValidationError(
        `Conflicting values supplied for filter '${canonicalKey}' and alias '${rawKey}'.`
      );
    }

    normalized[canonicalKey] = safeVal;
  }

  const result = roomDeckFilterSchema.safeParse(normalized);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw new ValidationError(firstIssue?.message || "Invalid room movie deck filter.", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  return canonicalizeObjectKeys(result.data);
}

/**
 * Resolves a stored room `deck_filter` JSON record into an explicit canonical filter,
 * filling safe non-adult movie defaults when `null`.
 */
export function resolveEffectiveRoomDeckFilter(
  stored: Record<string, unknown> | null | undefined
): CanonicalRoomDeckFilter {
  if (!stored) {
    return canonicalizeObjectKeys({ ...DEFAULT_ROOM_DECK_FILTER });
  }
  return normalizeRoomDeckFilter(stored);
}

/**
 * Produces deterministic sorted-key JSON for filter snapshots, seeds, and optimistic concurrency checks.
 */
export function canonicalSerializeDeckFilter(filter: CanonicalRoomDeckFilter): string {
  return JSON.stringify(canonicalizeObjectKeys(filter));
}

/**
 * Extracts and validates an optional `deckFilter` or `filters` property from an API request body.
 * Returns `undefined` when neither property is present on the body.
 */
export function parseOptionalDeckFilterFromBody(
  body: Record<string, unknown> | undefined
): CanonicalRoomDeckFilter | undefined {
  if (!body) return undefined;
  const hasDeckFilter = Object.prototype.hasOwnProperty.call(body, "deckFilter");
  const hasFilters = Object.prototype.hasOwnProperty.call(body, "filters");
  if (!hasDeckFilter && !hasFilters) {
    return undefined;
  }
  if (hasDeckFilter && hasFilters && body.deckFilter !== undefined && body.filters !== undefined) {
    const parsedA = normalizeRoomDeckFilter(body.deckFilter);
    const parsedB = normalizeRoomDeckFilter(body.filters);
    if (canonicalSerializeDeckFilter(parsedA) !== canonicalSerializeDeckFilter(parsedB)) {
      throw new ValidationError("Conflicting 'deckFilter' and 'filters' payloads supplied.");
    }
    return parsedA;
  }
  const raw = hasDeckFilter ? body.deckFilter : body.filters;
  return raw === undefined ? undefined : normalizeRoomDeckFilter(raw);
}
