import type { Metadata } from "next";

export const SITE_NAME = "Cinemania";
export const DEFAULT_SITE_TITLE = "Cinemania - Explore Movies & TV Shows";
export const DEFAULT_SITE_DESCRIPTION =
  "Discover trending movies, TV shows, cast profiles, trailers, and reviews on Cinemania.";

const DISALLOWED_PLACEHOLDER_HOSTS = new Set([
  "cinemania.com",
  "www.cinemania.com",
  "yourdomain.com",
  "www.yourdomain.com",
  "example.com",
  "www.example.com",
]);

/**
 * Resolves the canonical public origin from environment configuration without
 * falling back to placeholder domains.
 */
export function getConfiguredSiteUrl(
  env: Record<string, string | undefined> = process.env
): URL | undefined {
  const candidates = [
    env.NEXT_PUBLIC_SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
  ];

  for (const rawCandidate of candidates) {
    const trimmed = rawCandidate?.trim();
    if (!trimmed) {
      continue;
    }

    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    try {
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      if (DISALLOWED_PLACEHOLDER_HOSTS.has(parsed.hostname.toLowerCase())) {
        continue;
      }
      return new URL(parsed.origin);
    } catch {
      continue;
    }
  }

  return undefined;
}

export function normalizeKeywords(
  keywords?: string | string[]
): string[] | undefined {
  if (!keywords) {
    return undefined;
  }
  const items = Array.isArray(keywords)
    ? keywords
    : keywords.split(",");
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function createSiteMetadata(
  env: Record<string, string | undefined> = process.env
): Metadata {
  const siteUrl = getConfiguredSiteUrl(env);

  return {
    ...(siteUrl ? { metadataBase: siteUrl } : {}),
    title: {
      default: DEFAULT_SITE_TITLE,
      template: `%s | ${SITE_NAME}`,
    },
    description: DEFAULT_SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    keywords: ["movies", "tv shows", "trending", "discover", "cinema"],
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: DEFAULT_SITE_TITLE,
      description: DEFAULT_SITE_DESCRIPTION,
      siteName: SITE_NAME,
      type: "website",
      url: "/",
    },
    twitter: {
      card: "summary",
      title: DEFAULT_SITE_TITLE,
      description: DEFAULT_SITE_DESCRIPTION,
    },
  };
}

export interface PageMetadataOptions {
  title: string;
  description: string;
  path?: string;
  keywords?: string | string[];
  noIndex?: boolean;
  noFollow?: boolean;
}

export function buildPageMetadata(options: PageMetadataOptions): Metadata {
  const {
    title,
    description,
    path,
    keywords,
    noIndex = false,
    noFollow = false,
  } = options;

  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  const normalizedKeywords = normalizeKeywords(keywords);

  return {
    title,
    description,
    ...(normalizedKeywords ? { keywords: normalizedKeywords } : {}),
    ...(path ? { alternates: { canonical: path } } : {}),
    robots: {
      index: !noIndex,
      follow: !noFollow,
    },
    openGraph: {
      title: fullTitle,
      description,
      siteName: SITE_NAME,
      type: "website",
      ...(path ? { url: path } : {}),
    },
    twitter: {
      card: "summary",
      title: fullTitle,
      description,
    },
  };
}
