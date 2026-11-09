import { vi } from "vitest";

// Test setup file for Vitest
// Enforces offline defaults and dummy credentials to prevent live TMDB API calls

process.env.TMDB_API_RAT = "mock-tmdb-offline-rat-token";
process.env.NEXT_PUBLIC_TMDB_POSTER_URL = "https://image.tmdb.org/t/p";
process.env.NEXT_PUBLIC_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
process.env.IPINFO_TOKEN = "mock-ipinfo-offline-token";
process.env.YOUTUBE_API_KEY = "mock-youtube-offline-key";

// Allow server-only imports during test execution
vi.mock("server-only", () => ({}));
