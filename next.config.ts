import type { NextConfig } from "next";

// CINE-021 baseline response hardening. Deliberately no script/style CSP here: Next.js inline
// bootstrap scripts need a nonce-based policy that is a separate, tested change. `frame-ancestors`
// is the only CSP directive set, so nothing the app loads or embeds (TMDB images, YouTube embeds)
// is restricted; these headers only stop *this* app being framed or MIME-sniffed.
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  /* config options here */
  trailingSlash: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  env: {
    NEXT_PUBLIC_TMDB_POSTER_URL: process.env.NEXT_PUBLIC_TMDB_POSTER_URL || "https://image.tmdb.org/t/p",
    NEXT_PUBLIC_IMAGE_BASE_URL: process.env.NEXT_PUBLIC_IMAGE_BASE_URL || "https://image.tmdb.org/t/p",
  },
  images: {
    remotePatterns: [
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
    ],
  },
};

export default nextConfig;
