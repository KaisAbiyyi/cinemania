import fs from "node:fs";
import path from "node:path";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import robots, { createRobotsConfig } from "@/app/robots";
import MediaScrollableList from "@/feature/media/components/MediaScrollableList";
import {
  FilterProvider,
  useFilterContext,
} from "@/feature/media/components/filter/FilterProvider";
import apiClient from "@/services/apiClient";
import {
  daysInCalendarMonth,
  getLocalCalendarDateKey,
  getMsUntilNextLocalMidnight,
  resolveDiscoveryDatePresetFilters,
  resolveDiscoveryDatePresetQueryParams,
} from "@/lib/datePresets";
import {
  buildPageMetadata,
  createSiteMetadata,
  getConfiguredSiteUrl,
  isPreviewDeployment,
  normalizeKeywords,
} from "@/lib/metadata";
import { getPosterImageUrl, getProfileImageUrl } from "@/lib/utils";

const SRC_ROOT = path.resolve(process.cwd(), "src");

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe("CINE-009: Metadata configuration, preview hygiene, and URL safety", () => {
  it("omits metadataBase when no deployment origin is configured and never uses fake domains", () => {
    expect(isPreviewDeployment({})).toBe(false);
    expect(getConfiguredSiteUrl({})).toBeUndefined();
    const meta = createSiteMetadata({});
    expect(meta.metadataBase).toBeUndefined();
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.title).toEqual({
      default: "Cinemania - Explore Movies & TV Shows",
      template: "%s | Cinemania",
    });
    expect(JSON.stringify(meta)).not.toMatch(/cinemania\.com|yourdomain\.com|og-image\.jpg|\/og\//i);
  });

  it("rejects placeholder hostnames even when supplied via environment variables", () => {
    expect(getConfiguredSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://cinemania.com" })).toBeUndefined();
    expect(getConfiguredSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://yourdomain.com" })).toBeUndefined();
    expect(getConfiguredSiteUrl({ VERCEL_ENV: "production", VERCEL_URL: "example.com" })).toBeUndefined();
  });

  it("never falls back to VERCEL_URL branch-preview hosts for canonical origin and enforces noindex on preview-only env", () => {
    const previewOnlyEnv = { VERCEL_URL: "preview-branch-123.vercel.app" };
    expect(isPreviewDeployment(previewOnlyEnv)).toBe(true);
    expect(getConfiguredSiteUrl(previewOnlyEnv)).toBeUndefined();

    const previewSiteMeta = createSiteMetadata(previewOnlyEnv);
    expect(previewSiteMeta.metadataBase).toBeUndefined();
    expect(previewSiteMeta.robots).toEqual({ index: false, follow: false });

    const previewPageMeta = buildPageMetadata(
      {
        title: "Movies",
        description: "Explore movies.",
        path: "/movie",
      },
      previewOnlyEnv
    );
    expect(previewPageMeta.robots).toEqual({ index: false, follow: false });
    expect(createRobotsConfig(previewOnlyEnv)).toEqual({
      rules: [{ userAgent: "*", disallow: "/" }],
    });
  });

  it("on VERCEL_ENV=preview with production origin configured, prefers production canonical origin while keeping preview noindex and robots disallow", () => {
    const vercelPreviewEnv = {
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "prod.example.org",
      VERCEL_URL: "branch-preview-999.vercel.app",
    };
    expect(isPreviewDeployment(vercelPreviewEnv)).toBe(true);
    expect(getConfiguredSiteUrl(vercelPreviewEnv)?.toString()).toBe("https://prod.example.org/");
    expect(createSiteMetadata(vercelPreviewEnv).robots).toEqual({ index: false, follow: false });
    expect(
      buildPageMetadata(
        { title: "Trending Movies & TV Shows", description: "Trending.", path: "/trending" },
        vercelPreviewEnv
      ).robots
    ).toEqual({ index: false, follow: false });
    expect(createRobotsConfig(vercelPreviewEnv)).toEqual({
      rules: [{ userAgent: "*", disallow: "/" }],
    });
  });

  it("resolves production precedence NEXT_PUBLIC_SITE_URL > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL(prod) and enables indexing", () => {
    const withExplicitSiteUrl = {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://app.example.org/subpath/",
      VERCEL_PROJECT_PRODUCTION_URL: "prod.vercel.app",
      VERCEL_URL: "deploy-hash.vercel.app",
    };
    expect(isPreviewDeployment(withExplicitSiteUrl)).toBe(false);
    expect(getConfiguredSiteUrl(withExplicitSiteUrl)?.toString()).toBe("https://app.example.org/");
    expect(createSiteMetadata(withExplicitSiteUrl).robots).toEqual({ index: true, follow: true });
    expect(createRobotsConfig(withExplicitSiteUrl)).toEqual({
      rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/search"] }],
      host: "https://app.example.org",
    });

    expect(
      getConfiguredSiteUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "prod.example.org",
        VERCEL_URL: "deploy-hash.vercel.app",
      })?.toString()
    ).toBe("https://prod.example.org/");

    expect(
      getConfiguredSiteUrl({
        VERCEL_ENV: "production",
        VERCEL_URL: "deploy-hash.vercel.app",
      })?.toString()
    ).toBe("https://deploy-hash.vercel.app/");
  });

  it("builds crawlable page metadata with clean relative canonicals and optional noindex", () => {
    const meta = buildPageMetadata(
      {
        title: "Movies",
        description: "Explore movies.",
        path: "/movie",
        keywords: "movies, cinema, Cinemania",
      },
      {}
    );

    expect(meta.title).toBe("Movies");
    expect(meta.alternates?.canonical).toBe("/movie");
    expect(meta.openGraph?.url).toBe("/movie");
    expect(meta.openGraph?.title).toBe("Movies | Cinemania");
    expect(meta.openGraph?.images).toBeUndefined();
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(normalizeKeywords("a, b, , c")).toEqual(["a", "b", "c"]);

    const searchMeta = buildPageMetadata(
      {
        title: "Inception",
        description: 'Search results for "Inception"',
        path: "/search?q=Inception",
        noIndex: true,
      },
      {}
    );
    expect(searchMeta.robots).toEqual({ index: false, follow: true });
  });

  it("generates safe default robots.txt rules without placeholder hostnames", () => {
    const result = robots();
    expect(result.rules).toEqual([
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/search"],
      },
    ]);
    expect(result.host).toBeUndefined();
  });
});

describe("CINE-009: Deterministic clamped calendar-month & timezone date presets", () => {
  it("clamps month-end and leap-year dates instead of overflowing via Date.setMonth()", () => {
    expect(daysInCalendarMonth(2026, 2)).toBe(28);
    expect(daysInCalendarMonth(2024, 2)).toBe(29);
    expect(daysInCalendarMonth(1900, 2)).toBe(28);
    expect(daysInCalendarMonth(2000, 2)).toBe(29);

    // 2026-03-31 minus 1 month must clamp to 2026-02-28 (not roll over to 2026-03-03)
    const mar31NonLeap = new Date("2026-03-31T12:00:00.000Z");
    expect(
      resolveDiscoveryDatePresetFilters("movie-now-playing", mar31NonLeap, { timeZone: "UTC" })
    ).toEqual({
      release_date_gte: "2026-02-28",
      release_date_lte: "2026-03-31",
      with_release_type: "2|3",
    });

    // 2026-01-31 plus 1 month must clamp to 2026-02-28 (not roll over to 2026-03-03)
    const jan31NonLeap = new Date("2026-01-31T12:00:00.000Z");
    expect(
      resolveDiscoveryDatePresetFilters("movie-upcoming", jan31NonLeap, { timeZone: "UTC" })
    ).toEqual({
      release_date_gte: "2026-01-31",
      release_date_lte: "2026-02-28",
      with_release_type: "2|3",
    });

    // Leap year 2024 month-end clamping
    const mar31Leap = new Date("2024-03-31T12:00:00.000Z");
    expect(
      resolveDiscoveryDatePresetFilters("movie-now-playing", mar31Leap, { timeZone: "UTC" })
    ).toEqual({
      release_date_gte: "2024-02-29",
      release_date_lte: "2024-03-31",
      with_release_type: "2|3",
    });

    const jan31Leap = new Date("2024-01-31T12:00:00.000Z");
    expect(
      resolveDiscoveryDatePresetFilters("movie-upcoming", jan31Leap, { timeZone: "UTC" })
    ).toEqual({
      release_date_gte: "2024-01-31",
      release_date_lte: "2024-02-29",
      with_release_type: "2|3",
    });

    // Leap day 2024-02-29 rolling forward/backward
    const leapDay = new Date("2024-02-29T12:00:00.000Z");
    expect(
      resolveDiscoveryDatePresetFilters("movie-now-playing", leapDay, { timeZone: "UTC" })
    ).toEqual({
      release_date_gte: "2024-01-29",
      release_date_lte: "2024-02-29",
      with_release_type: "2|3",
    });
    expect(
      resolveDiscoveryDatePresetFilters("movie-upcoming", leapDay, { timeZone: "UTC" })
    ).toEqual({
      release_date_gte: "2024-02-29",
      release_date_lte: "2024-03-29",
      with_release_type: "2|3",
    });
    expect(resolveDiscoveryDatePresetFilters("tv-on-tv", leapDay, { timeZone: "UTC" })).toEqual({
      air_date_gte: "2024-02-29",
      air_date_lte: "2024-03-07",
    });

    // Dec/Jan year boundary
    const jan15 = new Date("2026-01-15T12:00:00.000Z");
    expect(
      resolveDiscoveryDatePresetFilters("movie-now-playing", jan15, { timeZone: "UTC" })
    ).toEqual({
      release_date_gte: "2025-12-15",
      release_date_lte: "2026-01-15",
      with_release_type: "2|3",
    });

    const dec28 = new Date("2025-12-28T12:00:00.000Z");
    expect(resolveDiscoveryDatePresetFilters("tv-on-tv", dec28, { timeZone: "UTC" })).toEqual({
      air_date_gte: "2025-12-28",
      air_date_lte: "2026-01-04",
    });
    const dec31 = new Date("2025-12-31T12:00:00.000Z");
    expect(
      resolveDiscoveryDatePresetFilters("movie-upcoming", dec31, { timeZone: "UTC" })
    ).toEqual({
      release_date_gte: "2025-12-31",
      release_date_lte: "2026-01-31",
      with_release_type: "2|3",
    });
  });

  it("evaluates Today using viewer calendar day across timezone boundaries", () => {
    // 2026-11-13T17:30:00Z is 2026-11-14 00:30 +07 (Asia/Jakarta), still 2026-11-13 in UTC & America/Los_Angeles
    const instant = new Date("2026-11-13T17:30:00.000Z");

    expect(
      resolveDiscoveryDatePresetFilters("tv-airing-today", instant, { timeZone: "Asia/Jakarta" })
    ).toEqual({
      air_date_gte: "2026-11-14",
      air_date_lte: "2026-11-14",
    });
    expect(
      resolveDiscoveryDatePresetFilters("tv-airing-today", instant, { timeZone: "UTC" })
    ).toEqual({
      air_date_gte: "2026-11-13",
      air_date_lte: "2026-11-13",
    });
    expect(
      resolveDiscoveryDatePresetFilters("tv-airing-today", instant, {
        timeZone: "America/Los_Angeles",
      })
    ).toEqual({
      air_date_gte: "2026-11-13",
      air_date_lte: "2026-11-13",
    });

    // New Year UTC transition: 2026-01-01T04:00:00Z is still 2025-12-31 23:00 in America/New_York
    const newYearInstant = new Date("2026-01-01T04:00:00.000Z");
    expect(
      resolveDiscoveryDatePresetFilters("movie-upcoming", newYearInstant, {
        timeZone: "America/New_York",
      })
    ).toEqual({
      release_date_gte: "2025-12-31",
      release_date_lte: "2026-01-31",
      with_release_type: "2|3",
    });
    expect(
      resolveDiscoveryDatePresetQueryParams("movie-now-playing", newYearInstant, {
        timeZone: "UTC",
      })
    ).toEqual({
      "release_date.gte": "2025-12-01",
      "release_date.lte": "2026-01-01",
      with_release_type: "2|3",
    });
  });

  it("refreshes open FilterProvider and MediaScrollableList presets across local midnight and wake without remount", async () => {
    vi.useFakeTimers();
    // 2026-03-30 23:59:50 in runner's local time (safe regardless of host timezone)
    vi.setSystemTime(new Date(2026, 2, 30, 23, 59, 50, 0));

    const getSpy = vi.spyOn(apiClient, "get").mockResolvedValue({
      data: { page: 1, results: [], total_pages: 1, total_results: 0 },
    } as never);

    const observedFilters: Array<{ release_date_gte?: string; release_date_lte?: string }> = [];
    function FilterProbe() {
      const { filters, isReady } = useFilterContext();
      if (isReady) {
        observedFilters.push({
          release_date_gte: filters.release_date_gte,
          release_date_lte: filters.release_date_lte,
        });
      }
      return React.createElement(
        "div",
        { "data-testid": "filter-probe" },
        `${filters.release_date_gte ?? ""}|${filters.release_date_lte ?? ""}`
      );
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const TypedFilterProvider = FilterProvider as React.ComponentType<{
      datePreset?: "movie-now-playing" | "tv-airing-today";
    }>;

    const view = render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          TypedFilterProvider,
          { datePreset: "movie-now-playing" },
          React.createElement(FilterProbe)
        ),
        React.createElement(MediaScrollableList, {
          title: "Now Playing Movies",
          orientation: "horizontal",
          type: "movie",
          datePreset: "movie-now-playing",
        })
      )
    );

    expect(view.getByTestId("filter-probe").textContent).toBe("2026-02-28|2026-03-30");
    await act(async () => {
      await Promise.resolve();
    });
    expect(getSpy).toHaveBeenCalledWith("/media", {
      params: expect.objectContaining({
        "release_date.gte": "2026-02-28",
        "release_date.lte": "2026-03-30",
      }),
    });

    // Advance clock across local midnight into 2026-03-31 00:00:05
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(getLocalCalendarDateKey(new Date())).toBe("2026-03-31");
    expect(view.getByTestId("filter-probe").textContent).toBe("2026-02-28|2026-03-31");
    expect(observedFilters[observedFilters.length - 1]).toEqual({
      release_date_gte: "2026-02-28",
      release_date_lte: "2026-03-31",
    });
    expect(getSpy).toHaveBeenCalledWith("/media", {
      params: expect.objectContaining({
        "release_date.gte": "2026-02-28",
        "release_date.lte": "2026-03-31",
      }),
    });

    // Simulate OS sleep / background tab resume jumping straight to 2026-04-01 without timer ticks
    vi.setSystemTime(new Date(2026, 3, 1, 9, 0, 0, 0));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(view.getByTestId("filter-probe").textContent).toBe("2026-03-01|2026-04-01");
    expect(getMsUntilNextLocalMidnight(new Date(2026, 3, 1, 23, 59, 0, 0))).toBeGreaterThanOrEqual(
      60_000
    );
  });

  it("uses configured TMDB image domain fallback cleanly without default-image-path", () => {
    expect(getPosterImageUrl("/abc.jpg")).toBe("https://image.tmdb.org/t/p/w500/abc.jpg");
    expect(getProfileImageUrl("def.jpg")).toBe("https://image.tmdb.org/t/p/w200/def.jpg");
    expect(getPosterImageUrl("")).toBe("/placeholder.jpg");

    const patterns = nextConfig.images?.remotePatterns ?? [];
    expect(patterns).toEqual([
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
        pathname: "/vi/**",
      },
    ]);
  });
});

describe("CINE-009: Source tree architecture & link hygiene", () => {
  it("contains zero fake production domains, missing /og assets, or placeholder image hosts in src/", () => {
    const files = collectSourceFiles(SRC_ROOT);
    const forbiddenUrl = /https?:\/\/(?:www\.)?(?:cinemania\.com|yourdomain\.com|default-image-path\.com)|og-image\.jpg|\/og\/[a-z0-9-]+\.jpg/i;

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content, `Forbidden placeholder URL in ${file}`).not.toMatch(forbiddenUrl);
    }
  });

  it("keeps RootLayout as a Server Component without a global Suspense fallback={null}", () => {
    const layoutSource = fs.readFileSync(path.join(SRC_ROOT, "app/layout.tsx"), "utf8");
    expect(layoutSource).not.toMatch(/["']use client["']/);
    expect(layoutSource).toMatch(/export const metadata:\s*Metadata/);
    expect(layoutSource).not.toMatch(/<Suspense\b/);

    const appShellSource = fs.readFileSync(path.join(SRC_ROOT, "components/layout/AppShell.tsx"), "utf8");
    expect(appShellSource).toMatch(/["']use client["']/);
    expect(appShellSource).not.toMatch(/<Suspense\b[^>]*fallback=\{null\}>/);
  });

  it("removes unjustified force-dynamic and build-time new Date() from public static browse routes", () => {
    const staticRoutes = [
      "app/page.tsx",
      "app/movie/now-playing/page.tsx",
      "app/movie/upcoming/page.tsx",
      "app/tv/airing-today/page.tsx",
      "app/tv/on-tv/page.tsx",
    ];

    for (const rel of staticRoutes) {
      const content = fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");
      expect(content, `${rel} must not use force-dynamic`).not.toMatch(/force-dynamic/);
      expect(content, `${rel} must not evaluate new Date() at build/SSR render time`).not.toMatch(/new Date\(/);
    }

    const searchPage = fs.readFileSync(path.join(SRC_ROOT, "app/search/page.tsx"), "utf8");
    expect(searchPage).toMatch(/export const dynamic\s*=\s*['"]force-dynamic['"]/);
  });

  it("uses Next Link for internal Sidebar navigation and safe anchors for external Footer links", () => {
    const sidebarSource = fs.readFileSync(path.join(SRC_ROOT, "components/layout/Sidebar.tsx"), "utf8");
    const activeSection = sidebarSource.split("{/*")[0];
    expect(activeSection).not.toMatch(/<a\s+href=\{item\.url\}/);
    expect(activeSection).toMatch(/<Link\s+href=\{item\.url\}/);

    const footerSource = fs.readFileSync(path.join(SRC_ROOT, "components/layout/Footer.tsx"), "utf8");
    expect(footerSource).not.toMatch(/href:\s*["']\/about["']/);
    expect(footerSource).not.toMatch(/<Link[^>]*target="_blank"/);
    expect(footerSource).not.toMatch(/url\("\/tv\/on-the-air"\)/);

    const tvReviewsSource = fs.readFileSync(path.join(SRC_ROOT, "app/tv/[slug]/reviews/page.tsx"), "utf8");
    expect(tvReviewsSource).not.toMatch(/about the movie/i);
    expect(tvReviewsSource).toMatch(/\/tv\/\$\{slug\}\/reviews/);
  });
});
