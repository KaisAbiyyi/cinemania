// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DECK_SIZE, type Candidate } from "@/db/schema";
import { ValidationError } from "@/lib/api/errorResponse";
import {
  DEFAULT_ROOM_DECK_FILTER,
  canonicalSerializeDeckFilter,
  normalizeRoomDeckFilter,
  parseOptionalDeckFilterFromBody,
  resolveEffectiveRoomDeckFilter,
} from "@/lib/schemas/roomDeck";
import {
  buildDeterministicCandidateList,
  buildUpstreamDiscoverMovieParams,
  fetchAndBuildDeterministicDeck,
  generateDeterministicDeckSeed,
  resolveCandidatePosterUrl,
  sanitizeDeckMovieEntry,
  sanitizePosterPath,
  toSafeDeckCandidate,
} from "@/lib/server/room/roomDeck";
import {
  DeckEmptyError,
  RoomCapacityError,
  validateStartRoundDeckBounds,
} from "@/lib/server/room/stateMachine";
import { TmdbApiError } from "@/services/tmdbApi";

function makeRawMovie(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Movie ${id}`,
    poster_path: `/poster-${id}.jpg`,
    overview: `Overview for movie ${id}`,
    release_date: "2024-05-10",
    vote_average: 7.5,
    adult: false,
    ...overrides,
  };
}

describe("CINE-016 Room Movie Deck Schema, Determinism, Sanitization & Boundaries", () => {
  describe("Common Movie Filter Validation & Canonicalization", () => {
    it("fills safe defaults and enforces include_adult=false when filter is absent or empty", () => {
      expect(normalizeRoomDeckFilter(undefined)).toEqual(DEFAULT_ROOM_DECK_FILTER);
      expect(normalizeRoomDeckFilter(null)).toEqual(DEFAULT_ROOM_DECK_FILTER);
      expect(normalizeRoomDeckFilter({})).toEqual(DEFAULT_ROOM_DECK_FILTER);
      expect(resolveEffectiveRoomDeckFilter(null)).toEqual(DEFAULT_ROOM_DECK_FILTER);
    });

    it("normalizes underscore aliases and canonicalizes keys deterministically regardless of insertion order", () => {
      const a = normalizeRoomDeckFilter({
        with_genres: "28,12",
        vote_average_gte: 7,
        release_date_lte: "2025-12-31",
        release_date_gte: "2020-01-01",
        sort_by: "vote_average.desc",
      });
      const b = normalizeRoomDeckFilter({
        sort_by: "vote_average.desc",
        "release_date.gte": "2020-01-01",
        "release_date.lte": "2025-12-31",
        "vote_average.gte": 7,
        with_genres: "28,12",
        include_adult: false,
        language: "en-US",
      });

      expect(a).toEqual(b);
      expect(canonicalSerializeDeckFilter(a)).toBe(canonicalSerializeDeckFilter(b));
      expect(Object.keys(a)).toEqual([...Object.keys(a)].sort((x, y) => x.localeCompare(y)));
    });

    it("rejects conflicting dotted and underscore alias filter keys", () => {
      expect(() =>
        normalizeRoomDeckFilter({
          "vote_average.gte": 6,
          vote_average_gte: 7,
        })
      ).toThrowError(ValidationError);
    });

    it("enforces adult content exclusion strictly (include_adult=true / 'true' / include_adults=true)", () => {
      expect(() => normalizeRoomDeckFilter({ include_adult: true })).toThrowError(ValidationError);
      expect(() => normalizeRoomDeckFilter({ include_adult: "true" })).toThrowError(ValidationError);
      expect(() => normalizeRoomDeckFilter({ include_adults: true })).toThrowError(ValidationError);
    });

    it("rejects TV-only keys, unknown keys, non-plain payloads, prototype pollution, URLs, control chars, and oversize JSON", () => {
      expect(() => normalizeRoomDeckFilter({ first_air_date_gte: "2024-01-01" })).toThrowError(
        ValidationError
      );
      expect(() => normalizeRoomDeckFilter({ with_networks: "213" })).toThrowError(ValidationError);
      expect(() => normalizeRoomDeckFilter({ arbitrary_key: "x" })).toThrowError(ValidationError);
      expect(() => normalizeRoomDeckFilter({ page: 2 })).toThrowError(ValidationError);
      expect(() => normalizeRoomDeckFilter(["28"])).toThrowError(ValidationError);
      expect(() => normalizeRoomDeckFilter("invalid")).toThrowError(ValidationError);

      const protoPayload = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
      expect(() => normalizeRoomDeckFilter(protoPayload)).toThrowError(ValidationError);
      expect(() =>
        normalizeRoomDeckFilter({ with_genres: "javascript:alert(1)" })
      ).toThrowError(ValidationError);
      expect(() => normalizeRoomDeckFilter({ with_genres: "28\x00" })).toThrowError(ValidationError);

      expect(() =>
        normalizeRoomDeckFilter({ with_keywords: "1,".repeat(1200) + "2" })
      ).toThrowError(ValidationError);
    });

    it("validates calendar dates, numeric/date range bounds, and watch_region requirement", () => {
      expect(() =>
        normalizeRoomDeckFilter({ "release_date.gte": "2026-02-30" })
      ).toThrowError(ValidationError);
      expect(() =>
        normalizeRoomDeckFilter({ "release_date.gte": "2023-02-29" })
      ).toThrowError(ValidationError);
      expect(
        normalizeRoomDeckFilter({ "release_date.gte": "2024-02-29" })["release_date.gte"]
      ).toBe("2024-02-29");

      expect(() =>
        normalizeRoomDeckFilter({ "vote_average.gte": 8, "vote_average.lte": 6 })
      ).toThrowError(ValidationError);
      expect(() =>
        normalizeRoomDeckFilter({ "vote_count.gte": 500, "vote_count.lte": 100 })
      ).toThrowError(ValidationError);
      expect(() =>
        normalizeRoomDeckFilter({ "with_runtime.gte": 180, "with_runtime.lte": 90 })
      ).toThrowError(ValidationError);
      expect(() =>
        normalizeRoomDeckFilter({
          "release_date.gte": "2025-05-01",
          "release_date.lte": "2025-04-01",
        })
      ).toThrowError(ValidationError);
      expect(() =>
        normalizeRoomDeckFilter({
          "primary_release_date.gte": "2025-05-01",
          "primary_release_date.lte": "2025-04-01",
        })
      ).toThrowError(ValidationError);

      expect(() => normalizeRoomDeckFilter({ with_watch_providers: "8|9" })).toThrowError(
        ValidationError
      );
      const validStreaming = normalizeRoomDeckFilter({
        with_watch_providers: "8|9",
        watch_region: "US",
      });
      expect(validStreaming.with_watch_providers).toBe("8|9");
      expect(validStreaming.watch_region).toBe("US");
    });

    it("handles parseOptionalDeckFilterFromBody cleanly for matching/missing/conflicting payloads", () => {
      expect(parseOptionalDeckFilterFromBody(undefined)).toBeUndefined();
      expect(parseOptionalDeckFilterFromBody({ quorum: 1 })).toBeUndefined();
      expect(parseOptionalDeckFilterFromBody({ deckFilter: { with_genres: "35" } })?.with_genres).toBe(
        "35"
      );
      expect(parseOptionalDeckFilterFromBody({ filters: { with_genres: "35" } })?.with_genres).toBe(
        "35"
      );
      expect(() =>
        parseOptionalDeckFilterFromBody({
          deckFilter: { with_genres: "35" },
          filters: { with_genres: "28" },
        })
      ).toThrowError(ValidationError);
    });
  });

  describe("Seeded Deterministic Shuffling, Boundary Counts, Images & Error Mapping", () => {
    it("produces byte-identical deck seeds & ordered candidate sequences across identical inputs and varies with room/round/filter", () => {
      const filterA = normalizeRoomDeckFilter({ with_genres: "28", "vote_average.gte": 6 });
      const filterB = normalizeRoomDeckFilter({ with_genres: "35", "vote_average.gte": 6 });
      const entries = Array.from({ length: 30 }, (_, idx) => {
        const sanitized = sanitizeDeckMovieEntry(makeRawMovie(1000 + idx));
        if (!sanitized) throw new Error("Expected valid movie fixture");
        return sanitized;
      });

      const seed1 = generateDeterministicDeckSeed("AABBCCDD-1111-2222-3333-444455556666", 1, filterA);
      const seed1Lower = generateDeterministicDeckSeed(
        "aabbccdd-1111-2222-3333-444455556666",
        1,
        filterA
      );
      const seedRound2 = generateDeterministicDeckSeed(
        "aabbccdd-1111-2222-3333-444455556666",
        2,
        filterA
      );
      const seedDiffFilter = generateDeterministicDeckSeed(
        "aabbccdd-1111-2222-3333-444455556666",
        1,
        filterB
      );

      expect(seed1).toBe(seed1Lower);
      expect(seed1).not.toBe(seedRound2);
      expect(seed1).not.toBe(seedDiffFilter);

      const deckA1 = buildDeterministicCandidateList(entries, seed1);
      const deckA2 = buildDeterministicCandidateList(entries, seed1);
      const deckR2 = buildDeterministicCandidateList(entries, seedRound2);

      expect(deckA1.candidates.map((c) => c.movieId)).toEqual(
        deckA2.candidates.map((c) => c.movieId)
      );
      expect(deckA1.candidates.map((c) => c.position)).toEqual(
        Array.from({ length: DECK_SIZE }, (_, i) => i)
      );
      // Mutational control: round 2 seed reorders deterministically
      expect(deckR2.candidates.map((c) => c.movieId)).not.toEqual(
        deckA1.candidates.map((c) => c.movieId)
      );
    });

    it("locks include_adult=false in upstream /discover/movie params", () => {
      const params = buildUpstreamDiscoverMovieParams(
        normalizeRoomDeckFilter({ with_genres: "28", watch_region: "US", with_watch_providers: "8" }),
        2
      );
      expect(params.page).toBe(2);
      expect(params.include_adult).toBe(false);
      expect(params.with_genres).toBe("28");
      expect(params.watch_region).toBe("US");
    });

    it("throws recoverable DeckEmptyError (422) on 0 results or when all returned rows are adult/invalid", async () => {
      await expect(
        fetchAndBuildDeterministicDeck({
          roomId: "00000000-0000-4000-8000-000000000001",
          roundNumber: 1,
          filter: normalizeRoomDeckFilter({}),
          discoverFetcher: async () => ({ page: 1, total_pages: 1, total_results: 0, results: [] }),
        })
      ).rejects.toMatchObject({ status: 422, code: "DECK_EMPTY" });

      await expect(
        fetchAndBuildDeterministicDeck({
          roomId: "00000000-0000-4000-8000-000000000001",
          roundNumber: 1,
          filter: normalizeRoomDeckFilter({}),
          discoverFetcher: async () => ({
            page: 1,
            total_pages: 1,
            total_results: 2,
            results: [
              makeRawMovie(101, { adult: true }),
              makeRawMovie(0, { adult: false }),
              makeRawMovie(102, { title: "   " }),
            ],
          }),
        })
      ).rejects.toBeInstanceOf(DeckEmptyError);
    });

    it("handles 1-title and 19-title shortages gracefully without fabricating filler rows", async () => {
      const single = await fetchAndBuildDeterministicDeck({
        roomId: "00000000-0000-4000-8000-000000000002",
        roundNumber: 1,
        filter: normalizeRoomDeckFilter({}),
        discoverFetcher: async () => ({
          page: 1,
          total_pages: 1,
          total_results: 1,
          results: [makeRawMovie(501, { adult: false }), makeRawMovie(502, { adult: true })],
        }),
      });
      expect(single.candidates).toHaveLength(1);
      expect(single.candidates[0]?.movieId).toBe(501);
      expect(single.candidates[0]?.position).toBe(0);
      expect(single.isShortage).toBe(true);

      const nineteen = await fetchAndBuildDeterministicDeck({
        roomId: "00000000-0000-4000-8000-000000000002",
        roundNumber: 1,
        filter: normalizeRoomDeckFilter({}),
        discoverFetcher: async () => ({
          page: 1,
          total_pages: 1,
          total_results: 19,
          results: Array.from({ length: 19 }, (_, idx) => makeRawMovie(600 + idx)),
        }),
      });
      expect(nineteen.candidates).toHaveLength(19);
      expect(nineteen.isShortage).toBe(true);
    });

    it("handles exact 20 results and caps 100 provider results strictly at 20 unique candidates across pages", async () => {
      const exact20 = await fetchAndBuildDeterministicDeck({
        roomId: "00000000-0000-4000-8000-000000000003",
        roundNumber: 1,
        filter: normalizeRoomDeckFilter({}),
        discoverFetcher: async () => ({
          page: 1,
          total_pages: 1,
          total_results: 20,
          results: Array.from({ length: 20 }, (_, idx) => makeRawMovie(700 + idx)),
        }),
      });
      expect(exact20.candidates).toHaveLength(20);
      expect(exact20.isShortage).toBe(false);
      expect(new Set(exact20.candidates.map((c) => c.movieId)).size).toBe(20);

      const singlePage100 = await fetchAndBuildDeterministicDeck({
        roomId: "00000000-0000-4000-8000-000000000004",
        roundNumber: 1,
        filter: normalizeRoomDeckFilter({}),
        discoverFetcher: async () => ({
          page: 1,
          total_pages: 5,
          total_results: 100,
          results: Array.from({ length: 100 }, (_, idx) => makeRawMovie(1000 + idx)),
        }),
      });
      expect(singlePage100.candidates).toHaveLength(20);
      expect(singlePage100.uniquePoolCount).toBe(100);
      expect(singlePage100.pagesFetched).toBe(1);
      expect(singlePage100.isShortage).toBe(false);

      const pageMock = vi.fn(async (params: Record<string, unknown>) => {
        const page = Number(params.page);
        if (page === 1) {
          return {
            page: 1,
            total_pages: 6,
            total_results: 100,
            results: [
              ...Array.from({ length: 12 }, (_, idx) => makeRawMovie(2000 + idx)),
              makeRawMovie(2000), // duplicate on same page
              makeRawMovie(2999, { adult: true }), // adult filtered
            ],
          };
        }
        return {
          page: 2,
          total_pages: 6,
          total_results: 100,
          results: [
            makeRawMovie(2001), // overlap from page 1
            ...Array.from({ length: 20 }, (_, idx) => makeRawMovie(2100 + idx)),
          ],
        };
      });

      const multiPage = await fetchAndBuildDeterministicDeck({
        roomId: "00000000-0000-4000-8000-000000000005",
        roundNumber: 1,
        filter: normalizeRoomDeckFilter({}),
        discoverFetcher: pageMock,
      });
      expect(pageMock).toHaveBeenCalledTimes(2);
      expect(multiPage.candidates).toHaveLength(20);
      expect(new Set(multiPage.candidates.map((c) => c.movieId)).size).toBe(20);
      expect(multiPage.candidates.some((c) => c.movieId === 2999)).toBe(false);
    });

    it("handles missing or unsafe poster_path and dirty metadata gracefully without broken URLs", () => {
      expect(sanitizePosterPath(null)).toBeNull();
      expect(sanitizePosterPath("")).toBeNull();
      expect(sanitizePosterPath("https://evil.example/a.jpg")).toBeNull();
      expect(sanitizePosterPath("//evil.example/a.jpg")).toBeNull();
      expect(sanitizePosterPath("/../etc/passwd")).toBeNull();
      expect(sanitizePosterPath("/bad path.jpg")).toBeNull();
      expect(resolveCandidatePosterUrl(null)).toBeNull();
      expect(resolveCandidatePosterUrl("/good_poster.jpg")).toMatch(/\/w500\/good_poster\.jpg$/);

      const entry = sanitizeDeckMovieEntry({
        id: 777,
        title: "  Movie\x00  With  Null Poster ",
        poster_path: null,
        overview: "",
        release_date: "not-a-date",
        vote_average: 14.5,
        adult: false,
      });
      expect(entry).toEqual({
        movieId: 777,
        title: "Movie With Null Poster",
        posterPath: null,
        overview: null,
        releaseDate: null,
        voteAverage: null,
      });

      const stored: Candidate = {
        id: "cand-1",
        round_id: "round-1",
        room_id: "room-1",
        movie_id: 777,
        position: 0,
        title: "Movie With Null Poster",
        poster_path: null,
        overview: null,
        release_date: null,
        vote_average: null,
      };
      expect(toSafeDeckCandidate(stored).posterUrl).toBeNull();
    });

    it("propagates TMDB 429/timeout/invalid responses cleanly without masking status or retryAfter", async () => {
      await expect(
        fetchAndBuildDeterministicDeck({
          roomId: "00000000-0000-4000-8000-000000000006",
          roundNumber: 1,
          filter: normalizeRoomDeckFilter({}),
          discoverFetcher: async () => {
            throw new TmdbApiError(429, "TMDB_RATE_LIMIT", "Rate limited", 9);
          },
        })
      ).rejects.toMatchObject({ status: 429, retryAfter: 9 });

      await expect(
        fetchAndBuildDeterministicDeck({
          roomId: "00000000-0000-4000-8000-000000000006",
          roundNumber: 1,
          filter: normalizeRoomDeckFilter({}),
          discoverFetcher: async () => ({ page: 1 }),
        })
      ).rejects.toMatchObject({ status: 502, code: "TMDB_INVALID_RESPONSE" });
    });

    it("enforces validateStartRoundDeckBounds invariants (2..5 participants, 1..20 candidates)", () => {
      expect(() => validateStartRoundDeckBounds(1, 20)).toThrowError(RoomCapacityError);
      expect(() => validateStartRoundDeckBounds(6, 20)).toThrowError(RoomCapacityError);
      expect(() => validateStartRoundDeckBounds(2, 0)).toThrowError(DeckEmptyError);
      expect(() => validateStartRoundDeckBounds(2, 21)).toThrowError(RoomCapacityError);
      expect(() => validateStartRoundDeckBounds(2, 1)).not.toThrow();
      expect(() => validateStartRoundDeckBounds(5, 20)).not.toThrow();
    });
  });
});
