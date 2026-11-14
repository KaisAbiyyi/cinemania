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

function parseSafeOrigin(rawCandidate?: string): URL | undefined {
  const trimmed = rawCandidate?.trim();
  if (!trimmed) {
    return undefined;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    if (DISALLOWED_PLACEHOLDER_HOSTS.has(parsed.hostname.toLowerCase())) {
      return undefined;
    }
    return new URL(parsed.origin);
  } catch {
    return undefined;
  }
}

/**
 * Determines whether the current build/runtime is a branch preview deployment
 * so preview deployments never advertise themselves as indexable or canonicalize
 * to ephemeral VERCEL_URL branch preview hosts.
 */
export function isPreviewDeployment(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.VERCEL_ENV === "preview") {
    return true;
  }
  if (env.VERCEL_ENV === "production") {
    return false;
  }

  const hasExplicitProductionOrigin = Boolean(
    parseSafeOrigin(env.NEXT_PUBLIC_SITE_URL) ||
      parseSafeOrigin(env.VERCEL_PROJECT_PRODUCTION_URL)
  );

  return !hasExplicitProductionOrigin && Boolean(parseSafeOrigin(env.VERCEL_URL));
}

/**
 * Resolves the canonical production public origin without falling back to
 * placeholder domains or ephemeral branch preview VERCEL_URL hosts.
 */
export function getConfiguredSiteUrl(
  env: Record<string, string | undefined> = process.env
): URL | undefined {
  const candidates = [
    env.NEXT_PUBLIC_SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    ...(env.VERCEL_ENV === "production" ? [env.VERCEL_URL] : []),
  ];

  for (const rawCandidate of candidates) {
    const parsed = parseSafeOrigin(rawCandidate);
    if (parsed) {
      return parsed;
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
  const items = Array.isArray(keywords) ? keywords : keywords.split(",");
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function createSiteMetadata(
  env: Record<string, string | undefined> = process.env
): Metadata {
  const previewDeployment = isPreviewDeployment(env);
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
    robots: previewDeployment
      ? { index: false, follow: false }
      : { index: true, follow: true },
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

export function buildPageMetadata(
  options: PageMetadataOptions,
  env: Record<string, string | undefined> = process.env
): Metadata {
  const {
    title,
    description,
    path,
    keywords,
    noIndex = false,
    noFollow = false,
  } = options;

  const previewDeployment = isPreviewDeployment(env);
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  const normalizedKeywords = normalizeKeywords(keywords);

  return {
    title,
    description,
    ...(normalizedKeywords ? { keywords: normalizedKeywords } : {}),
    ...(path ? { alternates: { canonical: path } } : {}),
    robots: previewDeployment
      ? { index: false, follow: false }
      : { index: !noIndex, follow: !noFollow },
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
