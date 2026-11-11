import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getDiscoverMedia } from "@/app/api/media/route";
import { GET as getTrendingMedia } from "@/app/api/media/trending/route";
import { GET as searchMovie } from "@/app/api/search/movie/route";
import { GET as searchTv } from "@/app/api/search/tv/route";
import { GET as searchPerson } from "@/app/api/search/person/route";
import { GET as searchKeyword } from "@/app/api/search/keyword/route";
import { GET as getKeywords } from "@/app/api/keywords/route";
import tmdbApi, { TmdbApiError } from "@/services/tmdbApi";
import { mockMoviesList } from "../fixtures/tmdb-fixtures";
import { buildMediaQueryParams } from "@/feature/media/components/filter/FilterProvider";
import { globalDefaultFilters } from "@/types/filters";

describe("CINE-007: Integration Tests for Discover & Search API Routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/media (Discover Endpoint)", () => {
    // P1-A: Regression test with real full FilterProvider defaults payload
    it("accepts full real default FilterProvider payload for movie and calls upstream with clean params (no 400)", async () => {
      const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
        data: mockMoviesList,
      } as never);

      const queryParams = buildMediaQueryParams("movie", globalDefaultFilters);
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined) searchParams.append(k, String(v));
      }

      const request = new Request(`http://localhost:3000/api/media?${searchParams.toString()}`);
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual(mockMoviesList);
      expect(spy).toHaveBeenCalled();
      const [endpoint] = spy.mock.calls[0];
      const options = spy.mock.calls[0][1] as { params: Record<string, unknown> };
      expect(endpoint).toBe("/discover/movie");
      expect(options.params.include_adult).toBe(false);
      expect(options.params.sort_by).toBe("popularity.desc");
      expect(options.params["release_date.gte"]).toBeUndefined();
    });

    // P1-A: Regression test with real full FilterProvider defaults payload for TV
    it("accepts full real default FilterProvider payload for tv and calls upstream without 400", async () => {
      const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
        data: { page: 1, results: [] },
      } as never);

      const queryParams = buildMediaQueryParams("tv", globalDefaultFilters);
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined) searchParams.append(k, String(v));
      }

      const request = new Request(`http://localhost:3000/api/media?${searchParams.toString()}`);
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalled();
      const [endpoint] = spy.mock.calls[0];
      expect(endpoint).toBe("/discover/tv");
    });

    it("returns 400 without calling provider when mediaType is missing", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/media?page=1");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.code).toBe("INVALID_REQUEST");
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 400 without calling provider when page exceeds bounds (page=501)", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/media?mediaType=movie&page=501");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.code).toBe("INVALID_REQUEST");
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 400 without calling provider on duplicate query parameters", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/media?mediaType=movie&page=1&page=2");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/Duplicate parameter "page" is not allowed/);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 400 without calling provider on arbitrary / non-whitelisted parameters", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/media?mediaType=movie&arbitrary_passthrough=true");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/Unrecognized query parameter "arbitrary_passthrough"/);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 400 without calling provider on external URL / scheme injection", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/media?mediaType=movie&sort_by=https://evil.com/payload");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/contains disallowed URL or protocol scheme/);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 200 and forwards cleaned typed filters to TMDB on valid request", async () => {
      const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
        data: mockMoviesList,
      } as never);

      const request = new Request(
        "http://localhost:3000/api/media?mediaType=movie&page=2&language=en-US&sort_by=popularity.desc&with_genres=28,12&vote_average.gte=7"
      );
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual(mockMoviesList);
      expect(spy).toHaveBeenCalledWith("/discover/movie", {
        params: {
          page: 2,
          language: "en-US",
          sort_by: "popularity.desc",
          with_genres: "28,12",
          "vote_average.gte": 7,
          include_adult: false,
        },
      });
    });

    // P1-B: Test TV sort options in GET /api/media
    it.each(["name.asc", "name.desc", "original_name.asc", "original_name.desc", "first_air_date.desc"])(
      "accepts TV sort option '%s' on tv discover route",
      async (tvSort) => {
        const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
          data: { page: 1, results: [] },
        } as never);

        const request = new Request(`http://localhost:3000/api/media?mediaType=tv&sort_by=${tvSort}`);
        const response = await getDiscoverMedia(request);

        expect(response.status).toBe(200);
        expect(spy).toHaveBeenCalledWith("/discover/tv", {
          params: {
            page: 1,
            language: "en-US",
            include_adult: false,
            sort_by: tvSort,
          },
        });
      }
    );

    // P2-A: Explicit 429 rate limit mapping with Retry-After header
    it("maps upstream TMDB 429 rate limit to HTTP 429 with Retry-After header", async () => {
      vi.spyOn(tmdbApi, "get").mockRejectedValueOnce(
        new TmdbApiError(429, "TMDB_RATE_LIMIT", "Rate limit exceeded")
      );

      const request = new Request("http://localhost:3000/api/media?mediaType=movie");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      const json = await response.json();
      expect(json.code).toBe("RATE_LIMITED");
    });

    // P2-A: Explicit 503 service unavailable mapping with Retry-After header
    it("maps upstream TMDB 503 service unavailable to HTTP 503 with Retry-After header", async () => {
      vi.spyOn(tmdbApi, "get").mockRejectedValueOnce(
        new TmdbApiError(503, "TMDB_UPSTREAM_ERROR", "TMDB is overloaded")
      );

      const request = new Request("http://localhost:3000/api/media?mediaType=movie");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("30");
      const json = await response.json();
      expect(json.code).toBe("SERVICE_UNAVAILABLE");
    });

    it("maps upstream TMDB 504 timeout to HTTP 504", async () => {
      vi.spyOn(tmdbApi, "get").mockRejectedValueOnce(
        new TmdbApiError(504, "TMDB_TIMEOUT", "Request timed out")
      );

      const request = new Request("http://localhost:3000/api/media?mediaType=movie");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(504);
      const json = await response.json();
      expect(json.code).toBe("GATEWAY_TIMEOUT");
    });

    it("maps upstream TMDB 500/502 to HTTP 502 Bad Gateway", async () => {
      vi.spyOn(tmdbApi, "get").mockRejectedValueOnce(
        new TmdbApiError(502, "TMDB_NETWORK_ERROR", "TMDB gateway error")
      );

      const request = new Request("http://localhost:3000/api/media?mediaType=movie");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(502);
      const json = await response.json();
      expect(json.code).toBe("BAD_GATEWAY");
    });

    it("maps upstream TMDB 401 auth error to sanitized HTTP 502 without leaking credentials", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(tmdbApi, "get").mockRejectedValueOnce(
        new TmdbApiError(401, "TMDB_UNAUTHORIZED", "Invalid API key")
      );

      const request = new Request("http://localhost:3000/api/media?mediaType=movie");
      const response = await getDiscoverMedia(request);

      expect(response.status).toBe(502);
      const json = await response.json();
      expect(json.code).toBe("UPSTREAM_AUTH_ERROR");
      expect(json.error).toBe("Upstream service authentication failure");
    });
  });

  describe("GET /api/media/trending", () => {
    it("returns 400 when missing parameters", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/media/trending");
      const response = await getTrendingMedia(request);

      expect(response.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 200 with valid parameters", async () => {
      const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
        data: { page: 1, results: [] },
      } as never);

      const request = new Request(
        "http://localhost:3000/api/media/trending?mediaType=movie&timeWindow=day&page=1"
      );
      const response = await getTrendingMedia(request);

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("/trending/movie/day", {
        params: { page: 1, language: "en-US" },
      });
    });
  });

  describe("GET /api/search/movie", () => {
    it("returns 400 without calling provider when query is missing", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/search/movie");
      const response = await searchMovie(request);

      expect(response.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });

    // P2-B: Conflicting query aliases
    it("returns 400 when conflicting 'q' and 'query' parameters are sent", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/search/movie?q=Interstellar&query=Oppenheimer");
      const response = await searchMovie(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/Conflicting query parameters/);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 200 and passes sanitized query and adult policy", async () => {
      const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
        data: mockMoviesList,
      } as never);

      const request = new Request("http://localhost:3000/api/search/movie?q=Interstellar&page=1");
      const response = await searchMovie(request);

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("/search/movie", {
        params: {
          query: "Interstellar",
          page: 1,
          language: "en-US",
          include_adult: false,
        },
      });
    });
  });

  describe("GET /api/search/tv", () => {
    it("returns 400 when query is missing", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/search/tv");
      const response = await searchTv(request);

      expect(response.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });

    // P2-B: Rejects movie-only parameter primary_release_year
    it("returns 400 when movie-only parameter primary_release_year is passed to /api/search/tv", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/search/tv?q=Dark&primary_release_year=2017");
      const response = await searchTv(request);

      expect(response.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 200 and passes query to /search/tv", async () => {
      const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
        data: { page: 1, results: [] },
      } as never);

      const request = new Request("http://localhost:3000/api/search/tv?q=Breaking+Bad");
      const response = await searchTv(request);

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("/search/tv", {
        params: {
          query: "Breaking Bad",
          page: 1,
          language: "en-US",
          include_adult: false,
        },
      });
    });
  });

  describe("GET /api/search/person", () => {
    it("calls /search/person (verifying fix for copy-paste bug that routed to /search/tv)", async () => {
      const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
        data: { page: 1, results: [] },
      } as never);

      const request = new Request("http://localhost:3000/api/search/person?q=Christopher+Nolan");
      const response = await searchPerson(request);

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("/search/person", {
        params: {
          query: "Christopher Nolan",
          page: 1,
          language: "en-US",
          include_adult: false,
        },
      });
    });

    // P2-B: Rejects year parameter on person search
    it("returns 400 when year parameter is passed to /api/search/person", async () => {
      const spy = vi.spyOn(tmdbApi, "get");
      const request = new Request("http://localhost:3000/api/search/person?q=Nolan&year=1970");
      const response = await searchPerson(request);

      expect(response.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/search/keyword and GET /api/keywords", () => {
    it("validates /api/search/keyword and forwards to /search/keyword", async () => {
      const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
        data: { page: 1, results: [] },
      } as never);

      const request = new Request("http://localhost:3000/api/search/keyword?q=heist");
      const response = await searchKeyword(request);

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("/search/keyword", {
        params: { query: "heist", page: 1 },
      });
    });

    it("validates /api/keywords and forwards to /search/keyword", async () => {
      const spy = vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
        data: { page: 1, results: [] },
      } as never);

      const request = new Request("http://localhost:3000/api/keywords?query=action");
      const response = await getKeywords(request);

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("/search/keyword", {
        params: { query: "action", page: 1 },
      });
    });
  });
});
