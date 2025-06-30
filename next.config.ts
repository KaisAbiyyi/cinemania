import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  trailingSlash: false,
  images: {
    domains: [
      'image.tmdb.org',
      "img.youtube.com"
    ]
  }
};

export default nextConfig;
