import { describe, it, expect } from "vitest";
import {
  extractAndGuardQueryParams,
  discoverMediaSchema,
  searchMovieSchema,
  searchTvSchema,
  searchPersonSchema,
  searchKeywordSchema,
  trendingMediaSchema,
  ALLOWED_DISCOVER_KEYS,
  ALLOWED_SEARCH_MOVIE_KEYS,
  ALLOWED_SEARCH_TV_KEYS,
  ALLOWED_SEARCH_PERSON_KEYS,
  ALLOWED_SEARCH_KEYWORD_KEYS,
  ALLOWED_TRENDING_KEYS,
  ALLOWED_MOVIE_SORT_VALUES,
  ALLOWED_TV_SORT_VALUES,
} from "@/lib/schemas/discoverSearch";
import { ValidationError } from "@/lib/api/errorResponse";

describe("CINE-007: extractAndGuardQueryParams low-level security guards", () => {
  it("allows whitelisted query parameters with valid values", () => {
    const params = new URLSearchParams("mediaType=movie&page=1&language=en-US");
    const result = extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS);
    expect(result).toEqual({
      mediaType: "movie",
      page: "1",
      language: "en-US",
    });
  });

  it("omits empty string parameters so default frontend filters pass cleanly", () => {
    const params = new URLSearchParams("mediaType=movie&page=1&with_genres=&release_date.gte=");
    const result = extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS);
    expect(result).toEqual({
      mediaType: "movie",
      page: "1",
    });
  });

  it("rejects arbitrary / unknown query parameters (no arbitrary TMDB passthrough)", () => {
    const params = new URLSearchParams("mediaType=movie&api_key=malicious&extra=injection");
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      ValidationError
    );
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      /Unrecognized query parameter "api_key"/
    );
  });

  it("rejects duplicate / repeated query parameters", () => {
    const params = new URLSearchParams();
    params.append("mediaType", "movie");
    params.append("page", "1");
    params.append("page", "2");

    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      ValidationError
    );
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      /Duplicate parameter "page" is not allowed/
    );
  });

  it.each([
    ["https://attacker.com/evil", "https URL"],
    ["http://evil.org", "http URL"],
    ["javascript:alert(1)", "javascript URI"],
    ["//evil.com/leak", "protocol-relative URL"],
    ["data:text/html,<script>", "data URI"],
  ])("rejects URL and protocol injection in value: %s (%s)", (injectionValue) => {
    const params = new URLSearchParams(`mediaType=movie&sort_by=${encodeURIComponent(injectionValue)}`);
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      ValidationError
    );
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      /contains disallowed URL or protocol scheme/
    );
  });

  it("rejects control characters in parameter keys or values", () => {
    const params = new URLSearchParams();
    params.append("mediaType", "movie\x00");
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      ValidationError
    );
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      /contains disallowed control characters/
    );
  });

  it("rejects parameter keys that exceed maximum key length", () => {
    const longKey = "a".repeat(50);
    const params = new URLSearchParams(`${longKey}=test`);
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      ValidationError
    );
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      /exceeds max length/
    );
  });

  it("rejects parameter values that exceed maximum value length", () => {
    const longVal = "b".repeat(350);
    const params = new URLSearchParams(`mediaType=${longVal}`);
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      ValidationError
    );
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      /exceeds max length/
    );
  });

  it("rejects query with more than MAX_TOTAL_PARAMS entries", () => {
    const params = new URLSearchParams();
    for (let i = 0; i < 30; i++) {
      params.append(`param_${i}`, "1");
    }
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      ValidationError
    );
    expect(() => extractAndGuardQueryParams(params, ALLOWED_DISCOVER_KEYS)).toThrowError(
      /Too many query parameters/
    );
  });
});

describe("CINE-007: discoverMediaSchema table-driven validation", () => {
  it.each(["movie", "tv"])("accepts valid mediaType: %s", (mediaType) => {
    const parsed = discoverMediaSchema.parse({ mediaType });
    expect(parsed.mediaType).toBe(mediaType);
    expect(parsed.page).toBe(1);
    expect(parsed.include_adult).toBe(false);
    expect(parsed.language).toBe("en-US");
  });

  it.each(["anime", "series", "music", "123", "", "MOVIE"])(
    "rejects invalid mediaType: %s",
    (invalidType) => {
      expect(() => discoverMediaSchema.parse({ mediaType: invalidType })).toThrow();
    }
  );

  it.each([1, 10, 250, 499, 500])("accepts bounded page in 1..500: %d", (page) => {
    const parsed = discoverMediaSchema.parse({ mediaType: "movie", page: String(page) });
    expect(parsed.page).toBe(page);
  });

  it.each([0, -1, 501, 1000, "abc", "1.5"])(
    "rejects out-of-bounds or non-integer page: %s",
    (invalidPage) => {
      expect(() => discoverMediaSchema.parse({ mediaType: "movie", page: invalidPage })).toThrow();
    }
  );

  it.each([
    ["false", false],
    ["true", true],
    [false, false],
    [true, true],
  ])("explicit adult policy: parses %s to %s", (input, expected) => {
    const parsed = discoverMediaSchema.parse({ mediaType: "movie", include_adult: input });
    expect(parsed.include_adult).toBe(expected);
  });

  it.each(["yes", "no", "1", "0", "maybe"])(
    "explicit adult policy: rejects invalid adult values: %s",
    (invalidAdult) => {
      expect(() =>
        discoverMediaSchema.parse({ mediaType: "movie", include_adult: invalidAdult })
      ).toThrow();
    }
  );

  it.each([
    "popularity.desc",
    "popularity.asc",
    "vote_average.desc",
    "release_date.desc",
    "revenue.desc",
  ])("accepts valid movie sort_by value: %s", (sort) => {
    const parsed = discoverMediaSchema.parse({ mediaType: "movie", sort_by: sort });
    expect(parsed.sort_by).toBe(sort);
  });

  it.each([
    "first_air_date.desc",
    "name.asc",
    "original_name.desc",
    "vote_average.asc",
  ])("accepts valid tv sort_by value: %s", (sort) => {
    const parsed = discoverMediaSchema.parse({ mediaType: "tv", sort_by: sort });
    expect(parsed.sort_by).toBe(sort);
  });

  it("rejects movie-only sort on tv mediaType and vice versa", () => {
    // release_date.desc is movie-only
    expect(() =>
      discoverMediaSchema.parse({ mediaType: "tv", sort_by: "release_date.desc" })
    ).toThrow(/Sort option 'release_date.desc' is not valid for mediaType 'tv'/);

    // name.asc is tv-only
    expect(() =>
      discoverMediaSchema.parse({ mediaType: "movie", sort_by: "name.asc" })
    ).toThrow(/Sort option 'name.asc' is not valid for mediaType 'movie'/);
  });

  it.each(["random", "vote_average.random", "ORDER BY id", "popularity"])
    ("rejects invalid sort_by value: %s", (invalidSort) => {
      expect(() => discoverMediaSchema.parse({ mediaType: "movie", sort_by: invalidSort })).toThrow();
    });

  it("validates numeric range filters and enforces lte >= gte", () => {
    const valid = discoverMediaSchema.parse({
      mediaType: "movie",
      "vote_average.gte": "7.5",
      "vote_average.lte": "9.0",
      "vote_count.gte": "100",
      "vote_count.lte": "50000",
      "with_runtime.gte": "90",
      "with_runtime.lte": "180",
    });
    expect(valid["vote_average.gte"]).toBe(7.5);
    expect(valid["vote_average.lte"]).toBe(9.0);

    // Inverted vote_average range
    expect(() =>
      discoverMediaSchema.parse({
        mediaType: "movie",
        "vote_average.gte": "8",
        "vote_average.lte": "6",
      })
    ).toThrow(/vote_average\.lte must be greater than or equal to vote_average\.gte/);

    // Inverted runtime range
    expect(() =>
      discoverMediaSchema.parse({
        mediaType: "movie",
        "with_runtime.gte": "150",
        "with_runtime.lte": "90",
      })
    ).toThrow(/with_runtime\.lte must be greater than or equal to with_runtime\.gte/);
  });

  it("validates date filters and enforces lte >= gte", () => {
    const valid = discoverMediaSchema.parse({
      mediaType: "movie",
      "release_date.gte": "2020-01-01",
      "release_date.lte": "2022-12-31",
    });
    expect(valid["release_date.gte"]).toBe("2020-01-01");
    expect(valid["release_date.lte"]).toBe("2022-12-31");

    // Inverted date range
    expect(() =>
      discoverMediaSchema.parse({
        mediaType: "movie",
        "release_date.gte": "2023-01-01",
        "release_date.lte": "2020-01-01",
      })
    ).toThrow(/release_date\.lte must be on or after release_date\.gte/);

    // Invalid date formats
    expect(() =>
      discoverMediaSchema.parse({
        mediaType: "movie",
        "release_date.gte": "2020/01/01",
      })
    ).toThrow();

    // Calendar invalidity: non-existent days
    expect(() =>
      discoverMediaSchema.parse({
        mediaType: "movie",
        "release_date.gte": "2026-02-31",
      })
    ).toThrow(/Invalid calendar date/);

    expect(() =>
      discoverMediaSchema.parse({
        mediaType: "movie",
        "release_date.gte": "2023-02-29", // not a leap year
      })
    ).toThrow(/Invalid calendar date/);

    // Valid leap year date
    const leapYear = discoverMediaSchema.parse({
      mediaType: "movie",
      "release_date.gte": "2024-02-29",
    });
    expect(leapYear["release_date.gte"]).toBe("2024-02-29");

    // Safe ISO timestamp normalization (e.g. from existing URL state / FilterContainer)
    const isoDate = discoverMediaSchema.parse({
      mediaType: "movie",
      "release_date.gte": "2026-11-11T00:00:00.000Z",
      "release_date.lte": "2026-11-12T23:59:59Z",
    });
    expect(isoDate["release_date.gte"]).toBe("2026-11-11");
    expect(isoDate["release_date.lte"]).toBe("2026-11-12");

    // Rejects impossible calendar dates even when formatted as ISO timestamps
    expect(() =>
      discoverMediaSchema.parse({
        mediaType: "movie",
        "release_date.gte": "2026-02-31T00:00:00.000Z",
      })
    ).toThrow(/Invalid calendar date/);
  });

  it("validates ID list filters and regions", () => {
    const valid = discoverMediaSchema.parse({
      mediaType: "movie",
      with_genres: "28,12|16",
      with_watch_providers: "8|9|337",
      watch_region: "US",
      with_original_language: "ja",
      with_release_type: "2|3",
    });
    expect(valid.with_genres).toBe("28,12|16");
    expect(valid.watch_region).toBe("US");
    expect(valid.with_original_language).toBe("ja");

    // Invalid region code (must be 2 uppercase letters)
    expect(() =>
      discoverMediaSchema.parse({
        mediaType: "movie",
        watch_region: "usa",
      })
    ).toThrow();

    // Invalid genre string
    expect(() =>
      discoverMediaSchema.parse({
        mediaType: "movie",
        with_genres: "action,drama",
      })
    ).toThrow();
  });
});

describe("CINE-007: searchMovieSchema table-driven validation & Unicode support", () => {
  it.each([
    ["Inception", "Latin English"],
    ["千と千尋の神隠し", "Japanese Kanji & Hiragana"],
    ["スタジオジブリ", "Japanese Katakana"],
    ["기생충", "Korean Hangul"],
    ["المصفوفة", "Arabic Script"],
    ["Сталкер", "Cyrillic Russian"],
    ["Amélie Poulain", "Accented Latin French"],
    ["El laberinto del fauno", "Spanish Latin"],
    ["🎬 Popcorn & Movies 🍿", "Emoji and symbols"],
    ["Spider-Man: Across the Spider-Verse (2023)", "Punctuation & numbers"],
  ])("accepts valid Unicode search query: %s (%s)", (query) => {
    const parsed = searchMovieSchema.parse({ q: query });
    expect(parsed.q).toBe(query.trim());
    expect(parsed.page).toBe(1);
    expect(parsed.include_adult).toBe(false);
  });

  it("accepts query parameter named 'query' as alternative to 'q'", () => {
    const parsed = searchMovieSchema.parse({ query: "Interstellar" });
    expect(parsed.query).toBe("Interstellar");
  });

  it("rejects request when 'q' and 'query' have conflicting values", () => {
    expect(() =>
      searchMovieSchema.parse({ q: "Batman", query: "Superman" })
    ).toThrowError(/Conflicting query parameters/);
  });

  it("accepts request when 'q' and 'query' have identical values", () => {
    const parsed = searchMovieSchema.parse({ q: "Batman", query: "Batman" });
    expect(parsed.q).toBe("Batman");
  });

  it("rejects search when both 'q' and 'query' are missing or empty", () => {
    expect(() => searchMovieSchema.parse({})).toThrow(/Query parameter 'q' or 'query' is required/);
    expect(() => searchMovieSchema.parse({ q: "   " })).toThrow();
  });

  it("bounds search page in 1..500", () => {
    expect(searchMovieSchema.parse({ q: "Batman", page: "500" }).page).toBe(500);
    expect(() => searchMovieSchema.parse({ q: "Batman", page: "501" })).toThrow();
    expect(() => searchMovieSchema.parse({ q: "Batman", page: "0" })).toThrow();
  });

  it("allows year and primary_release_year in searchMovieSchema", () => {
    const parsed = searchMovieSchema.parse({
      q: "Inception",
      year: "2010",
      primary_release_year: "2010",
    });
    expect(parsed.year).toBe(2010);
    expect(parsed.primary_release_year).toBe(2010);
  });
});

describe("CINE-007: searchTvSchema and searchPersonSchema validations", () => {
  it("validates searchTvSchema with year (maps to first_air_date_year)", () => {
    const parsed = searchTvSchema.parse({
      q: "Dark",
      year: "2017",
      page: "2",
    });
    expect(parsed.q).toBe("Dark");
    expect(parsed.year).toBe(2017);
    expect(parsed.page).toBe(2);
  });

  it("rejects primary_release_year in searchTvSchema (movie-only filter)", () => {
    expect(() =>
      extractAndGuardQueryParams(
        new URLSearchParams("q=Breaking+Bad&primary_release_year=2008"),
        ALLOWED_SEARCH_TV_KEYS
      )
    ).toThrowError(/Unrecognized query parameter "primary_release_year"/);
  });

  it("validates searchPersonSchema with query and page", () => {
    const parsed = searchPersonSchema.parse({
      q: "Cillian Murphy",
      page: "1",
    });
    expect(parsed.q).toBe("Cillian Murphy");
    expect(parsed.page).toBe(1);
    expect(parsed.include_adult).toBe(false);
  });

  it("rejects year in searchPersonSchema", () => {
    expect(() =>
      extractAndGuardQueryParams(
        new URLSearchParams("q=Nolan&year=1970"),
        ALLOWED_SEARCH_PERSON_KEYS
      )
    ).toThrowError(/Unrecognized query parameter "year"/);
  });
});

describe("CINE-007: trendingMediaSchema validation", () => {
  it("accepts valid mediaType and timeWindow combinations", () => {
    const parsed = trendingMediaSchema.parse({ mediaType: "all", timeWindow: "day" });
    expect(parsed.mediaType).toBe("all");
    expect(parsed.timeWindow).toBe("day");
  });

  it("rejects invalid mediaType in trending", () => {
    expect(() => trendingMediaSchema.parse({ mediaType: "person", timeWindow: "day" })).toThrow();
  });

  it("rejects invalid timeWindow in trending", () => {
    expect(() => trendingMediaSchema.parse({ mediaType: "movie", timeWindow: "month" })).toThrow();
  });
});

describe("CINE-007: searchKeywordSchema & allowed key sets", () => {
  it("validates searchKeywordSchema with allowed keys", () => {
    const raw = extractAndGuardQueryParams(
      new URLSearchParams("q=thriller&page=2"),
      ALLOWED_SEARCH_KEYWORD_KEYS
    );
    const parsed = searchKeywordSchema.parse(raw);
    expect(parsed.q).toBe("thriller");
    expect(parsed.page).toBe(2);
  });

  it("verifies allowed keys sets are properly populated", () => {
    expect(ALLOWED_SEARCH_MOVIE_KEYS.has("primary_release_year")).toBe(true);
    expect(ALLOWED_SEARCH_TV_KEYS.has("year")).toBe(true);
    expect(ALLOWED_SEARCH_TV_KEYS.has("primary_release_year")).toBe(false);
    expect(ALLOWED_SEARCH_PERSON_KEYS.has("year")).toBe(false);
    expect(ALLOWED_SEARCH_KEYWORD_KEYS.has("query")).toBe(true);
    expect(ALLOWED_TRENDING_KEYS.has("timeWindow")).toBe(true);
    expect(ALLOWED_MOVIE_SORT_VALUES).toContain("popularity.desc");
    expect(ALLOWED_TV_SORT_VALUES).toContain("name.asc");
  });
});
