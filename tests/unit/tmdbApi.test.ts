import { describe, it, expect } from "vitest";
import tmdbApi from "@/services/tmdbApi";

describe("src/services/tmdbApi unit tests", () => {
  it("initializes with TMDB v3 base URL and headers", () => {
    expect(tmdbApi.defaults.baseURL).toBe("https://api.themoviedb.org/3");
    expect(tmdbApi.defaults.timeout).toBe(10000);
    expect(tmdbApi.defaults.headers.Accept).toBe("application/json");
  });

  it("uses the configured authorization token from environment", () => {
    const authHeader = tmdbApi.defaults.headers.Authorization;
    expect(authHeader).toBe("Bearer mock-tmdb-offline-rat-token");
  });
});
