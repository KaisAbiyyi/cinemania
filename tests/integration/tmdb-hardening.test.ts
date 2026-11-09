import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import tmdbApi, {
  TmdbConfigurationError,
  TmdbHostValidationError,
  isTmdbError,
} from "@/services/tmdbApi";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import nextConfig from "../../next.config";

describe("CINE-006: TMDB integration hardening & security verification", () => {
  const originalEnv = process.env.TMDB_API_RAT;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.TMDB_API_RAT = "mock-tmdb-offline-rat-token";
  });

  afterEach(() => {
    process.env.TMDB_API_RAT = originalEnv;
  });

  describe("API Route Integration with Hardened Client", () => {
    it("safely handles upstream 401 Unauthorized without exposing credentials in logs", async () => {
      const sensitiveToken = "super-secret-test-token-777";
      process.env.TMDB_API_RAT = sensitiveToken;

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalAdapter = tmdbApi.defaults.adapter;

      tmdbApi.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
        const error = new AxiosError(
          "Request failed with status code 401",
          "ERR_BAD_REQUEST",
          config,
          {},
          {
            status: 401,
            statusText: "Unauthorized",
            data: { status_message: "Invalid API key: You must be granted a valid key." },
            headers: {},
            config,
          } as never
        );
        throw error;
      };

      try {
        await tmdbApi.get("/genre/movie/list");
        expect.unreachable("Should have thrown 401");
      } catch (err) {
        // Calling handler logs the error
        console.error("Route handler caught error:", err);

        expect(isTmdbError(err)).toBe(true);
        if (isTmdbError(err)) {
          expect(err.status).toBe(401);
          expect(err.code).toBe("TMDB_UNAUTHORIZED");
        }

        // Verify that the logged error and spy never contained the raw sensitive token
        for (const call of consoleSpy.mock.calls) {
          const serialized = JSON.stringify(call);
          expect(serialized).not.toContain(sensitiveToken);
        }
      } finally {
        tmdbApi.defaults.adapter = originalAdapter;
        consoleSpy.mockRestore();
      }
    });

    it("safely handles upstream 429 Rate Limit with sanitized stable error shape", async () => {
      const originalAdapter = tmdbApi.defaults.adapter;

      tmdbApi.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
        const error = new AxiosError(
          "Request failed with status code 429",
          "ERR_BAD_REQUEST",
          config,
          {},
          {
            status: 429,
            statusText: "Too Many Requests",
            data: { status_message: "Rate limit reached" },
            headers: {},
            config,
          } as never
        );
        throw error;
      };

      try {
        await tmdbApi.get("/movie/top_rated");
        expect.unreachable("Should have thrown 429");
      } catch (err) {
        expect(isTmdbError(err)).toBe(true);
        if (isTmdbError(err)) {
          expect(err.status).toBe(429);
          expect(err.code).toBe("TMDB_RATE_LIMIT");
          expect(err.message).toContain("rate limit exceeded");
        }
      } finally {
        tmdbApi.defaults.adapter = originalAdapter;
      }
    });

    it("safely handles upstream 503 Service Unavailable with sanitized stable error shape", async () => {
      const originalAdapter = tmdbApi.defaults.adapter;

      tmdbApi.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
        const error = new AxiosError(
          "Request failed with status code 503",
          "ERR_BAD_RESPONSE",
          config,
          {},
          {
            status: 503,
            statusText: "Service Unavailable",
            data: {},
            headers: {},
            config,
          } as never
        );
        throw error;
      };

      try {
        await tmdbApi.get("/movie/popular");
        expect.unreachable("Should have thrown 503");
      } catch (err) {
        expect(isTmdbError(err)).toBe(true);
        if (isTmdbError(err)) {
          expect(err.status).toBe(503);
          expect(err.code).toBe("TMDB_UPSTREAM_ERROR");
          expect(err.message).toContain("HTTP 503");
        }
      } finally {
        tmdbApi.defaults.adapter = originalAdapter;
      }
    });

    it("fails safely and immediately when TMDB_API_RAT is unset", async () => {
      delete process.env.TMDB_API_RAT;

      await expect(tmdbApi.get("/movie/now_playing")).rejects.toThrow(TmdbConfigurationError);
      await expect(tmdbApi.get("/movie/now_playing")).rejects.toThrow(
        "TMDB_API_RAT is missing or empty. Server request aborted."
      );
    });

    it("rejects SSRF attempts with non-allowlisted target URLs and protocol-relative paths", async () => {
      await expect(tmdbApi.get("https://evil-server.attacker.com/steal")).rejects.toThrow(
        TmdbHostValidationError
      );
      await expect(tmdbApi.get("http://localhost:8080/internal")).rejects.toThrow(
        TmdbHostValidationError
      );
      await expect(tmdbApi.get("//malicious.com/api")).rejects.toThrow(
        TmdbHostValidationError
      );
    });

    it("blocks and rejects HTTP 301/302 redirects with maxRedirects: 0", async () => {
      const originalAdapter = tmdbApi.defaults.adapter;

      tmdbApi.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
        const error = new AxiosError(
          "Max redirects exceeded",
          "ERR_BAD_RESPONSE",
          config,
          {},
          {
            status: 301,
            statusText: "Moved Permanently",
            headers: { location: "https://evil.com/redirect" },
            data: {},
            config,
          } as never
        );
        throw error;
      };

      try {
        await tmdbApi.get("/movie/550");
        expect.unreachable("Should have thrown redirect error");
      } catch (err) {
        expect(isTmdbError(err)).toBe(true);
        if (isTmdbError(err)) {
          expect(err.status).toBe(301);
          expect(err.code).toBe("TMDB_REDIRECT_BLOCKED");
          expect(err.message).toContain("redirect was blocked");
        }
      } finally {
        tmdbApi.defaults.adapter = originalAdapter;
      }
    });
  });

  describe("Safe Next.js Image Configuration", () => {
    it("configures strict HTTPS and pathname allowlist for TMDB images", () => {
      const remotePatterns = nextConfig.images?.remotePatterns;
      expect(Array.isArray(remotePatterns)).toBe(true);

      const tmdbPattern = remotePatterns?.find(
        (p: { hostname?: string }) => p.hostname === "image.tmdb.org"
      );

      expect(tmdbPattern).toBeDefined();
      expect(tmdbPattern?.protocol).toBe("https");
      expect(tmdbPattern?.hostname).toBe("image.tmdb.org");
      expect(tmdbPattern?.pathname).toBe("/t/p/**");
    });
  });
});
