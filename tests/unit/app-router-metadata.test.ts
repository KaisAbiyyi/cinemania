import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import robots from "@/app/robots";
import { resolveDiscoveryDatePresetFilters, resolveDiscoveryDatePresetQueryParams } from "@/lib/datePresets";
import {
  buildPageMetadata,
  createSiteMetadata,
  getConfiguredSiteUrl,
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

describe("CINE-009: Metadata configuration and URL safety", () => {
  it("omits metadataBase when no deployment origin is configured and never uses fake domains", () => {
    expect(getConfiguredSiteUrl({})).toBeUndefined();
    const meta = createSiteMetadata({});
    expect(meta.metadataBase).toBeUndefined();
    expect(meta.title).toEqual({
      default: "Cinemania - Explore Movies & TV Shows",
      template: "%s | Cinemania",
    });
    expect(JSON.stringify(meta)).not.toMatch(/cinemania\.com|yourdomain\.com|og-image\.jpg|\/og\//i);
  });

  it("rejects placeholder hostnames even when supplied via environment variables", () => {
    expect(getConfiguredSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://cinemania.com" })).toBeUndefined();
    expect(getConfiguredSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://yourdomain.com" })).toBeUndefined();
    expect(getConfiguredSiteUrl({ VERCEL_URL: "example.com" })).toBeUndefined();
  });

  it("resolves priority order NEXT_PUBLIC_SITE_URL > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL", () => {
    expect(
      getConfiguredSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://app.example.org/subpath/",
        VERCEL_PROJECT_PRODUCTION_URL: "prod.vercel.app",
        VERCEL_URL: "preview.vercel.app",
      })?.toString()
    ).toBe("https://app.example.org/");

    expect(
      getConfiguredSiteUrl({
        VERCEL_PROJECT_PRODUCTION_URL: "prod.vercel.app",
        VERCEL_URL: "preview.vercel.app",
      })?.toString()
    ).toBe("https://prod.vercel.app/");

    expect(
      getConfiguredSiteUrl({
        VERCEL_URL: "preview-123.vercel.app",
      })?.toString()
    ).toBe("https://preview-123.vercel.app/");
  });

  it("builds crawlable page metadata with clean relative canonicals and optional noindex", () => {
    const meta = buildPageMetadata({
      title: "Movies",
      description: "Explore movies.",
      path: "/movie",
      keywords: "movies, cinema, Cinemania",
    });

    expect(meta.title).toBe("Movies");
    expect(meta.alternates?.canonical).toBe("/movie");
    expect(meta.openGraph?.url).toBe("/movie");
    expect(meta.openGraph?.title).toBe("Movies | Cinemania");
    expect(meta.openGraph?.images).toBeUndefined();
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(normalizeKeywords("a, b, , c")).toEqual(["a", "b", "c"]);

    const searchMeta = buildPageMetadata({
      title: "Inception",
      description: 'Search results for "Inception"',
      path: "/search?q=Inception",
      noIndex: true,
    });
    expect(searchMeta.robots).toEqual({ index: false, follow: true });
  });

  it("generates safe robots.txt rules without placeholder hostnames", () => {
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

describe("CINE-009: Deterministic date presets and image config", () => {
  it("computes rolling YYYY-MM-DD date presets from a reference date without mutating it", () => {
    const ref = new Date("2026-06-15T12:00:00.000Z");
    const nowPlaying = resolveDiscoveryDatePresetFilters("movie-now-playing", ref);
    const upcoming = resolveDiscoveryDatePresetFilters("movie-upcoming", ref);
    const airingToday = resolveDiscoveryDatePresetFilters("tv-airing-today", ref);
    const onTv = resolveDiscoveryDatePresetFilters("tv-on-tv", ref);

    expect(ref.toISOString()).toBe("2026-06-15T12:00:00.000Z");
    expect(nowPlaying).toEqual({
      release_date_gte: "2026-05-15",
      release_date_lte: "2026-06-15",
      with_release_type: "2|3",
    });
    expect(upcoming).toEqual({
      release_date_gte: "2026-06-15",
      release_date_lte: "2026-07-15",
      with_release_type: "2|3",
    });
    expect(airingToday).toEqual({
      air_date_gte: "2026-06-15",
      air_date_lte: "2026-06-15",
    });
    expect(onTv).toEqual({
      air_date_gte: "2026-06-15",
      air_date_lte: "2026-06-22",
    });

    expect(resolveDiscoveryDatePresetQueryParams("movie-now-playing", ref)).toEqual({
      "release_date.gte": "2026-05-15",
      "release_date.lte": "2026-06-15",
      with_release_type: "2|3",
    });
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
