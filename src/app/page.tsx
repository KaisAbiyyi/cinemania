import { Metadata } from "next";
import Image from "next/image";


export const metadata: Metadata = {
  title: "Cinemania - Explore Movies & TV Shows",
  description: "Discover trending movies and TV shows with Cinemania.",
  keywords: ["movies", "tv shows", "trending", "watchlist", "favorites", "cinema"],
  openGraph: {
    title: "Cinemania",
    description: "Explore the latest movies and TV shows.",
    url: "https://cinemania.com",
    siteName: "Cinemania",
    type: "website",
    images: [
      {
        url: "https://cinemania.com/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Cinemania Banner",
      },
    ],
  },
};

export default function Home() {
  return (
   <h1>anjay gua ganteng</h1>
  );
}
