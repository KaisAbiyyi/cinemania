import type { MetadataRoute } from "next";
import {
  getConfiguredSiteUrl,
  isPreviewDeployment,
} from "@/lib/metadata";

export function createRobotsConfig(
  env: Record<string, string | undefined> = process.env
): MetadataRoute.Robots {
  if (isPreviewDeployment(env)) {
    return {
      rules: [
        {
          userAgent: "*",
          disallow: "/",
        },
      ],
    };
  }

  const siteUrl = getConfiguredSiteUrl(env);

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/search"],
      },
    ],
    ...(siteUrl ? { host: siteUrl.origin } : {}),
  };
}

export default function robots(): MetadataRoute.Robots {
  return createRobotsConfig();
}
