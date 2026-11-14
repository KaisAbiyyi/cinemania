import "server-only";
import crypto from "node:crypto";
import { DECK_SIZE, type Candidate } from "@/db/schema";
import { CONTROL_CHAR_PATTERN } from "@/lib/schemas/discoverSearch";
import {
  canonicalSerializeDeckFilter,
  type CanonicalRoomDeckFilter,
  type SafeDeckCandidate,
} from "@/lib/schemas/roomDeck";
import type { CandidateInput } from "@/lib/server/room/roomRepository";
import { DeckEmptyError } from "@/lib/server/room/stateMachine";
import tmdbApi, { TmdbApiError } from "@/services/tmdbApi";

const DEFAULT_TMDB_POSTER_BASE = "https://image.tmdb.org/t/p";
const DEFAULT_MAX_DISCOVER_PAGES = 5;
const MAX_TITLE_LENGTH = 255;
const MAX_POSTER_PATH_LENGTH = 255;
const MAX_OVERVIEW_LENGTH = 2000;
const MAX_RELEASE_DATE_LENGTH = 20;

export interface TmdbDiscoverMovieItem {
  id?: unknown;
  title?: unknown;
  original_title?: unknown;
  poster_path?: unknown;
  overview?: unknown;
  release_date?: unknown;
  vote_average?: unknown;
  adult?: unknown;
}

export interface TmdbDiscoverMovieResponse {
  page?: unknown;
  total_pages?: unknown;
  total_results?: unknown;
  results?: unknown;
}

export type TmdbDiscoverMovieFetcher = (
  params: Record<string, unknown>
) => Promise<TmdbDiscoverMovieResponse>;

export interface BuildRoomDeckOptions {
  roomId: string;
  roundNumber: number;
  filter: CanonicalRoomDeckFilter;
  targetSize?: number;
  maxPages?: number;
  discoverFetcher?: TmdbDiscoverMovieFetcher;
}

export interface PositionedCandidateInput extends CandidateInput {
  position: number;
}

export interface BuiltRoomDeckResult {
  candidates: PositionedCandidateInput[];
  fetchedCount: number;
  uniquePoolCount: number;
  pagesFetched: number;
  isShortage: boolean;
  deckSeed: string;
  filter: CanonicalRoomDeckFilter;
}

/**
 * Resolves a validated relative TMDB poster path (e.g. `/abc.jpg`) into a safe HTTPS URL.
 * Returns `null` when poster metadata is missing or invalid (graceful missing image handling).
 */
export function resolveCandidatePosterUrl(posterPath: string | null | undefined): string | null {
  const sanitizedPath = sanitizePosterPath(posterPath);
  if (!sanitizedPath) {
    return null;
  }
  const baseRaw = (process.env.NEXT_PUBLIC_TMDB_POSTER_URL || DEFAULT_TMDB_POSTER_BASE).trim();
  const base = baseRaw.replace(/\/+$/, "");
  return `${base}/w500${sanitizedPath}`;
}

export function sanitizePosterPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_POSTER_PATH_LENGTH) return null;
  if (CONTROL_CHAR_PATTERN.test(trimmed) || /\s/.test(trimmed)) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("..")) {
    return null;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function sanitizeTitle(raw: TmdbDiscoverMovieItem): string | null {
  const candidate = typeof raw.title === "string" ? raw.title : raw.original_title;
  if (typeof candidate !== "string") return null;
  const cleaned = candidate.replace(CONTROL_CHAR_PATTERN, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_TITLE_LENGTH);
}

function sanitizeOverview(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_OVERVIEW_LENGTH);
}

function sanitizeReleaseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_RELEASE_DATE_LENGTH) return null;
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeVoteAverage(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 10) return null;
  return Math.round(value * 10) / 10;
}

/**
 * Sanitizes an upstream TMDB movie entry into a validated deck candidate shape.
 * Rejects adult titles, non-integer/non-positive TMDB IDs, and missing titles;
 * normalizes missing posters/overviews/dates/ratings gracefully to `null`.
 */
export function sanitizeDeckMovieEntry(raw: unknown): Omit<CandidateInput, "position"> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const item = raw as TmdbDiscoverMovieItem;
  if (item.adult === true) {
    return null;
  }
  if (typeof item.id !== "number" || !Number.isInteger(item.id) || item.id <= 0) {
    return null;
  }
  const title = sanitizeTitle(item);
  if (!title) {
    return null;
  }

  return {
    movieId: item.id,
    title,
    posterPath: sanitizePosterPath(item.poster_path),
    overview: sanitizeOverview(item.overview),
    releaseDate: sanitizeReleaseDate(item.release_date),
    voteAverage: sanitizeVoteAverage(item.vote_average),
  };
}

/**
 * Computes a stable SHA-256 round seed from room identity, round number, and canonical filters.
 */
export function generateDeterministicDeckSeed(
  roomId: string,
  roundNumber: number,
  filter: CanonicalRoomDeckFilter
): string {
  const canonicalFilter = canonicalSerializeDeckFilter(filter);
  return crypto
    .createHash("sha256")
    .update(`cinematch-deck-v1|${roomId.toLowerCase()}|${roundNumber}|${canonicalFilter}`)
    .digest("hex");
}

/**
 * Deduplicates by `movieId` and performs a seeded deterministic Fisher-Yates shuffle
 * using SHA-256 counter bytes (zero client/per-guest randomness, identical across callers).
 */
export function buildDeterministicCandidateList(
  entries: ReadonlyArray<Omit<CandidateInput, "position">>,
  deckSeed: string,
  targetSize: number = DECK_SIZE
): { candidates: PositionedCandidateInput[]; uniquePoolCount: number } {
  const uniqueMap = new Map<number, Omit<CandidateInput, "position">>();
  for (const entry of entries) {
    if (!uniqueMap.has(entry.movieId)) {
      uniqueMap.set(entry.movieId, entry);
    }
  }

  const pool = Array.from(uniqueMap.values());
  let counter = 0;

  const nextUint32 = (): number => {
    const digest = crypto
      .createHash("sha256")
      .update(`${deckSeed}:${counter}`)
      .digest();
    counter += 1;
    return digest.readUInt32BE(0);
  };

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = nextUint32() % (i + 1);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  const boundedTarget = Math.max(0, Math.min(targetSize, DECK_SIZE));
  const selected = pool.slice(0, boundedTarget);
  return {
    candidates: selected.map((item, position) => ({
      ...item,
      position,
    })),
    uniquePoolCount: pool.length,
  };
}

/**
 * Builds clean upstream TMDB `/discover/movie` query params from a canonical room filter.
 * Explicitly locks `include_adult: false`.
 */
export function buildUpstreamDiscoverMovieParams(
  filter: CanonicalRoomDeckFilter,
  page: number
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    page,
    include_adult: false,
  };
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== "") {
      params[key] = key === "include_adult" ? false : value;
    }
  }
  return params;
}

async function defaultDiscoverMovieFetcher(
  params: Record<string, unknown>
): Promise<TmdbDiscoverMovieResponse> {
  const response = await tmdbApi.get<TmdbDiscoverMovieResponse>("/discover/movie", { params });
  return response.data;
}

/**
 * Fetches `/discover/movie` pages from TMDB, deduplicates and filters adult/invalid titles,
 * deterministically seeds and caps up to `DECK_SIZE` (20) unique candidates, and throws
 * recoverable `DeckEmptyError` (422) when 0 valid titles match.
 */
export async function fetchAndBuildDeterministicDeck(
  options: BuildRoomDeckOptions
): Promise<BuiltRoomDeckResult> {
  const targetSize = Math.max(1, Math.min(options.targetSize ?? DECK_SIZE, DECK_SIZE));
  const maxPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_DISCOVER_PAGES, 10));
  const fetcher = options.discoverFetcher ?? defaultDiscoverMovieFetcher;
  const deckSeed = generateDeterministicDeckSeed(
    options.roomId,
    options.roundNumber,
    options.filter
  );

  const uniqueEntries = new Map<number, Omit<CandidateInput, "position">>();
  let fetchedCount = 0;
  let pagesFetched = 0;
  let totalPagesAvailable = 1;

  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1 && (page > totalPagesAvailable || uniqueEntries.size >= targetSize)) {
      break;
    }

    const params = buildUpstreamDiscoverMovieParams(options.filter, page);
    const payload = await fetcher(params);
    pagesFetched += 1;

    if (!payload || !Array.isArray(payload.results)) {
      throw new TmdbApiError(
        502,
        "TMDB_INVALID_RESPONSE",
        "Upstream TMDB discover response was missing a results array."
      );
    }

    const parsedTotalPages =
      typeof payload.total_pages === "number" && Number.isFinite(payload.total_pages)
        ? Math.max(0, Math.floor(payload.total_pages))
        : 1;
    totalPagesAvailable = Math.min(parsedTotalPages || 1, maxPages);

    if (payload.results.length === 0) {
      break;
    }

    fetchedCount += payload.results.length;
    const beforeUnique = uniqueEntries.size;

    for (const rawItem of payload.results) {
      const sanitized = sanitizeDeckMovieEntry(rawItem);
      if (sanitized && !uniqueEntries.has(sanitized.movieId)) {
        uniqueEntries.set(sanitized.movieId, sanitized);
      }
    }

    const addedUnique = uniqueEntries.size - beforeUnique;
    if (uniqueEntries.size >= targetSize || (page > 1 && addedUnique === 0)) {
      break;
    }
  }

  const { candidates, uniquePoolCount } = buildDeterministicCandidateList(
    Array.from(uniqueEntries.values()),
    deckSeed,
    targetSize
  );

  if (candidates.length < 1) {
    throw new DeckEmptyError();
  }

  return {
    candidates,
    fetchedCount,
    uniquePoolCount,
    pagesFetched,
    isShortage: candidates.length < targetSize,
    deckSeed,
    filter: options.filter,
  };
}

/**
 * Converts a stored database Candidate row into an API-safe deck item for participants.
 */
export function toSafeDeckCandidate(candidate: Candidate): SafeDeckCandidate {
  const posterPath = sanitizePosterPath(candidate.poster_path);
  return {
    candidateId: candidate.id,
    position: candidate.position,
    movieId: candidate.movie_id,
    title: candidate.title,
    posterPath,
    posterUrl: resolveCandidatePosterUrl(posterPath),
    overview: candidate.overview ?? null,
    releaseDate: candidate.release_date ?? null,
    voteAverage:
      typeof candidate.vote_average === "number" && Number.isFinite(candidate.vote_average)
        ? Math.round(candidate.vote_average * 10) / 10
        : null,
  };
}
