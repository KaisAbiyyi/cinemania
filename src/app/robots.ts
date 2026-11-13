import type { MetadataRoute } from "next";
import { getConfiguredSiteUrl } from "@/lib/metadata";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getConfiguredSiteUrl();

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
