import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import tmdbApi, {
  TMDB_BASE_URL,
  ALLOWED_TMDB_HOSTS,
  TmdbConfigurationError,
  TmdbHostValidationError,
  TmdbApiError,
  isTmdbError,
  validateUpstreamUrl,
  sanitizeAndMapError,
} from "@/services/tmdbApi";
import { AxiosError, type InternalAxiosRequestConfig, type AxiosResponse } from "axios";

describe("CINE-006: TMDB server-only client and credentials hardening unit tests", () => {
  const originalEnv = process.env.TMDB_API_RAT;

  beforeEach(() => {
    process.env.TMDB_API_RAT = "mock-secret-token-12345";
  });

  afterEach(() => {
    process.env.TMDB_API_RAT = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Configuration & Environment", () => {
    it("has the strict base URL, timeout, and maxRedirects defaults", () => {
      expect(tmdbApi.defaults.baseURL).toBe("https://api.themoviedb.org/3");
      expect(tmdbApi.defaults.timeout).toBe(10000);
      expect(tmdbApi.defaults.maxRedirects).toBe(0);
      expect(tmdbApi.defaults.headers.Accept).toBe("application/json");
      expect(ALLOWED_TMDB_HOSTS.has("api.themoviedb.org")).toBe(true);
      expect(ALLOWED_TMDB_HOSTS.size).toBe(1);
    });

    it("throws TmdbConfigurationError if TMDB_API_RAT is missing or empty", async () => {
      delete process.env.TMDB_API_RAT;

      const config: InternalAxiosRequestConfig = {
        headers: {} as never,
        url: "/movie/popular",
      } as InternalAxiosRequestConfig;

      const requestHandlers = (tmdbApi.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig }>;
      }).handlers;

      expect(requestHandlers.length).toBeGreaterThan(0);
      const interceptor = requestHandlers[0].fulfilled;

      expect(() => interceptor(config)).toThrow(TmdbConfigurationError);
      expect(() => interceptor(config)).toThrow("TMDB_API_RAT is missing or empty");
    });

    it("injects Authorization header when token is present", () => {
      process.env.TMDB_API_RAT = "valid-test-token-xyz";

      const config: InternalAxiosRequestConfig = {
        headers: {} as never,
        url: "/genre/movie/list",
      } as InternalAxiosRequestConfig;

      const requestHandlers = (tmdbApi.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig }>;
      }).handlers;

      const interceptor = requestHandlers[0].fulfilled;
      const updatedConfig = interceptor(config);

      expect(updatedConfig.headers.Authorization).toBe("Bearer valid-test-token-xyz");
    });

    it("does not mutate process.env.TMDB_API_RAT through defaults setter", () => {
      const original = process.env.TMDB_API_RAT;
      // Attempt to mutate through defaults header setter
      (tmdbApi.defaults.headers as Record<string, unknown>).Authorization = "Bearer malicious-token-override";
      expect(process.env.TMDB_API_RAT).toBe(original);
      expect(tmdbApi.defaults.headers.Authorization).toBe(`Bearer ${original}`);
    });

    it("authoritatively overwrites caller-supplied Authorization headers in request options", () => {
      process.env.TMDB_API_RAT = "server-authoritative-token";

      const config: InternalAxiosRequestConfig = {
        headers: {
          Authorization: "Bearer caller-spoofed-token",
        } as never,
        url: "/movie/now_playing",
      } as InternalAxiosRequestConfig;

      const requestHandlers = (tmdbApi.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig }>;
      }).handlers;

      const interceptor = requestHandlers[0].fulfilled;
      const updatedConfig = interceptor(config);

      // Caller spoofed token must be replaced by authoritative server token
      expect(updatedConfig.headers.Authorization).toBe("Bearer server-authoritative-token");
      expect(updatedConfig.headers.Authorization).not.toBe("Bearer caller-spoofed-token");
    });
  });

  describe("Host allowlisting, URL validation, and Destination Pinning", () => {
    it("allows relative endpoint paths", () => {
      expect(() => validateUpstreamUrl("/genre/movie/list", TMDB_BASE_URL)).not.toThrow();
      expect(() => validateUpstreamUrl("/movie/550", TMDB_BASE_URL)).not.toThrow();
      expect(() => validateUpstreamUrl("/search/movie?query=matrix", TMDB_BASE_URL)).not.toThrow();
    });

    it("allows absolute URLs that match api.themoviedb.org", () => {
      expect(() => validateUpstreamUrl("https://api.themoviedb.org/3/movie/top_rated")).not.toThrow();
    });

    it("strictly rejects protocol-relative URLs", () => {
      expect(() => validateUpstreamUrl("//evil.com/steal")).toThrow(TmdbHostValidationError);
      expect(() => validateUpstreamUrl("//api.themoviedb.org/movie")).toThrow(TmdbHostValidationError);
    });

    it("strictly rejects arbitrary upstream URLs", () => {
      expect(() => validateUpstreamUrl("https://malicious-site.com/steal-token")).toThrow(TmdbHostValidationError);
      expect(() => validateUpstreamUrl("http://attacker.org/3/movie")).toThrow(TmdbHostValidationError);
      expect(() => validateUpstreamUrl("https://themoviedb.org/api")).toThrow(TmdbHostValidationError);
      expect(() => validateUpstreamUrl("ftp://api.themoviedb.org/file")).toThrow(TmdbHostValidationError);
    });

    it("strictly rejects arbitrary baseURLs", () => {
      expect(() => validateUpstreamUrl("/movie/popular", "https://unauthorized-domain.com")).toThrow(
        TmdbHostValidationError
      );
    });

    it("rejects caller attempts to override baseURL in request config", () => {
      const config: InternalAxiosRequestConfig = {
        headers: {} as never,
        url: "/movie/popular",
        baseURL: "https://attacker.org/override",
      } as InternalAxiosRequestConfig;

      const requestHandlers = (tmdbApi.interceptors.request as unknown as {
        handlers: Array<{ fulfilled: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig }>;
      }).handlers;

      const interceptor = requestHandlers[0].fulfilled;
      expect(() => interceptor(config)).toThrow(TmdbHostValidationError);
      expect(() => interceptor(config)).toThrow("baseURL override rejected");
    });
  });

  describe("Upstream error mapping and sanitization", () => {
    const secretToken = "super-secret-production-rat-key-never-leak";

    it("maps HTTP 401 to TMDB_UNAUTHORIZED without leaking credentials", () => {
      const axiosError = new AxiosError(
        "Request failed with status code 401",
        "ERR_BAD_REQUEST",
        {
          headers: { Authorization: `Bearer ${secretToken}` },
        } as unknown as InternalAxiosRequestConfig,
        {},
        {
          status: 401,
          statusText: "Unauthorized",
          data: { status_message: "Invalid API key" },
        } as AxiosResponse
      );

      const mapped = sanitizeAndMapError(axiosError);

      expect(mapped).toBeInstanceOf(TmdbApiError);
      expect(isTmdbError(mapped)).toBe(true);
      if (isTmdbError(mapped)) {
        expect(mapped.status).toBe(401);
        expect(mapped.code).toBe("TMDB_UNAUTHORIZED");
        expect(mapped.message).toContain("invalid or expired credentials");
      }

      // Assert Authorization was redacted
      expect(axiosError.config?.headers?.Authorization).toBe("Bearer [REDACTED]");
      expect(JSON.stringify(mapped)).not.toContain(secretToken);
      expect(mapped.message).not.toContain(secretToken);
    });

    it("maps HTTP 429 to TMDB_RATE_LIMIT", () => {
      const axiosError = new AxiosError(
        "Request failed with status code 429",
        "ERR_BAD_REQUEST",
        {} as InternalAxiosRequestConfig,
        {},
        {
          status: 429,
          statusText: "Too Many Requests",
          data: { status_message: "Your request count (#) is over the allowed limit of (40)." },
        } as AxiosResponse
      );

      const mapped = sanitizeAndMapError(axiosError);

      expect(mapped).toBeInstanceOf(TmdbApiError);
      expect(isTmdbError(mapped)).toBe(true);
      if (isTmdbError(mapped)) {
        expect(mapped.status).toBe(429);
        expect(mapped.code).toBe("TMDB_RATE_LIMIT");
        expect(mapped.message).toContain("rate limit exceeded");
      }
    });

    it("maps HTTP 500/502/503 to TMDB_UPSTREAM_ERROR", () => {
      for (const status of [500, 502, 503]) {
        const axiosError = new AxiosError(
          `Request failed with status code ${status}`,
          "ERR_BAD_RESPONSE",
          {} as InternalAxiosRequestConfig,
          {},
          {
            status,
            statusText: "Server Error",
            data: {},
          } as AxiosResponse
        );

        const mapped = sanitizeAndMapError(axiosError);

        expect(mapped).toBeInstanceOf(TmdbApiError);
        expect(isTmdbError(mapped)).toBe(true);
        if (isTmdbError(mapped)) {
          expect(mapped.status).toBe(status);
          expect(mapped.code).toBe("TMDB_UPSTREAM_ERROR");
          expect(mapped.message).toContain(`HTTP ${status}`);
        }
      }
    });

    it("maps timeout ECONNABORTED to TMDB_TIMEOUT with status 504", () => {
      const axiosError = new AxiosError(
        "timeout of 10000ms exceeded",
        "ECONNABORTED",
        {
          headers: { Authorization: `Bearer ${secretToken}` },
        } as unknown as InternalAxiosRequestConfig
      );

      const mapped = sanitizeAndMapError(axiosError);

      expect(mapped).toBeInstanceOf(TmdbApiError);
      expect(isTmdbError(mapped)).toBe(true);
      if (isTmdbError(mapped)) {
        expect(mapped.status).toBe(504);
        expect(mapped.code).toBe("TMDB_TIMEOUT");
        expect(mapped.message).toContain("timed out");
      }

      // Assert Authorization header is redacted
      expect(axiosError.config?.headers?.Authorization).toBe("Bearer [REDACTED]");
      expect(mapped.message).not.toContain(secretToken);
    });

    it("maps network errors without response to TMDB_NETWORK_ERROR with status 502", () => {
      const axiosError = new AxiosError(
        "Network Error",
        "ERR_NETWORK",
        {} as InternalAxiosRequestConfig
      );

      const mapped = sanitizeAndMapError(axiosError);

      expect(isTmdbError(mapped)).toBe(true);
      if (isTmdbError(mapped)) {
        expect(mapped.status).toBe(502);
        expect(mapped.code).toBe("TMDB_NETWORK_ERROR");
      }
    });

    it("maps blocked HTTP 301/302 redirects to TMDB_REDIRECT_BLOCKED", () => {
      const axiosError = new AxiosError(
        "Max redirects exceeded",
        "ERR_BAD_RESPONSE",
        {} as InternalAxiosRequestConfig,
        {},
        {
          status: 301,
          statusText: "Moved Permanently",
          headers: { location: "https://evil.com/redirect" },
          data: {},
        } as unknown as AxiosResponse
      );

      const mapped = sanitizeAndMapError(axiosError);

      expect(mapped).toBeInstanceOf(TmdbApiError);
      if (isTmdbError(mapped)) {
        expect(mapped.status).toBe(301);
        expect(mapped.code).toBe("TMDB_REDIRECT_BLOCKED");
        expect(mapped.message).toContain("redirect was blocked");
      }
    });
  });

  describe("Mocked Axios Adapter Outgoing Dispatch Verification", () => {
    it("asserts actual outgoing dispatch carries Bearer token and maxRedirects: 0", async () => {
      process.env.TMDB_API_RAT = "adapter-sentinel-test-token";

      const originalAdapter = tmdbApi.defaults.adapter;
      let capturedConfig: InternalAxiosRequestConfig | null = null;

      tmdbApi.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
        capturedConfig = config;
        return {
          data: { success: true },
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      };

      try {
        await tmdbApi.get("/genre/movie/list", {
          headers: {
            Authorization: "Bearer attacker-spoof",
          } as never,
        });

        expect(capturedConfig).not.toBeNull();
        const finalConfig = capturedConfig as unknown as InternalAxiosRequestConfig;
        expect(finalConfig.headers?.Authorization).toBe("Bearer adapter-sentinel-test-token");
        expect(finalConfig.baseURL).toBe("https://api.themoviedb.org/3");
        expect(finalConfig.maxRedirects).toBe(0);
      } finally {
        tmdbApi.defaults.adapter = originalAdapter;
      }
    });
  });
});
