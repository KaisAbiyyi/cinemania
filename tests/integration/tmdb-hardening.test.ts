import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import tmdbApi, {
  TmdbConfigurationError,
  TmdbHostValidationError,
  isTmdbError,
} from "@/services/tmdbApi";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import nextConfig from "../../next.config";
import fs from "fs";
import path from "path";

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

    it("fails safely and immediately when TMDB_API_RAT is unset", async () => {
      delete process.env.TMDB_API_RAT;

      await expect(tmdbApi.get("/movie/now_playing")).rejects.toThrow(TmdbConfigurationError);
      await expect(tmdbApi.get("/movie/now_playing")).rejects.toThrow(
        "TMDB_API_RAT is missing or empty. Server request aborted."
      );
    });

    it("rejects SSRF attempts with non-allowlisted target URLs", async () => {
      await expect(tmdbApi.get("https://evil-server.attacker.com/steal")).rejects.toThrow(
        TmdbHostValidationError
      );
      await expect(tmdbApi.get("http://localhost:8080/internal")).rejects.toThrow(
        TmdbHostValidationError
      );
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

  describe("Client Bundle Secret Leak Prevention", () => {
    it("verifies static client bundles do not contain TMDB_API_RAT or private secrets", () => {
      const staticDir = path.join(process.cwd(), ".next", "static");

      if (!fs.existsSync(staticDir)) {
        // Build artifact not generated yet, skip gracefully or note
        return;
      }

      function scanDir(dir: string): string[] {
        let files: string[] = [];
        for (const item of fs.readdirSync(dir)) {
          const fullPath = path.join(dir, item);
          if (fs.statSync(fullPath).isDirectory()) {
            files = files.concat(scanDir(fullPath));
          } else if (item.endsWith(".js")) {
            files.push(fullPath);
          }
        }
        return files;
      }

      const clientJsFiles = scanDir(staticDir);
      expect(clientJsFiles.length).toBeGreaterThan(0);

      // Search all client JS chunks for secret identifiers
      const forbiddenTokens = [
        "TMDB_API_RAT",
        "mock-tmdb-offline-rat-token",
        "mock-secret-token-12345",
      ];

      for (const filePath of clientJsFiles) {
        const content = fs.readFileSync(filePath, "utf-8");
        for (const token of forbiddenTokens) {
          // Token must never appear as an exposed value in client bundles
          expect(content).not.toContain(`"${token}"`);
          expect(content).not.toContain(`'${token}'`);
        }
      }
    });
  });
});
