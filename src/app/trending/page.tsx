import TrendingContainer from "@/feature/media/components/TrendingContainer";
import TrendingFilters from "@/feature/media/components/filter/TrendingFilters";
import { Metadata } from "next";
import { FC } from "react";

export const metadata: Metadata = {
    title: "Trending Movies & TV Shows | Cinemania",
    description: "Discover the latest trending movies and TV shows updated weekly. Stay up-to-date with the most popular content on Cinemania.",
    keywords: "trending movies, trending tv shows, popular movies, best movies, best tv shows, Cinemania",
    openGraph: {
        title: "Trending Movies & TV Shows | Cinemania",
        description: "Explore the latest trending movies and TV shows, updated weekly with fresh content on Cinemania.",
        url: "https://cinemania.com/trending",
        siteName: "Cinemania",
        images: [
            {
                url: "https://cinemania.com/og/trending.jpg", 
                width: 1200,
                height: 630,
                alt: "Trending Movies & TV Shows",
            },
        ],
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "Trending Movies & TV Shows | Cinemania",
        description: "Find out which movies and TV shows are trending this week on Cinemania.",
        images: ["https://cinemania.com/og/trending.jpg"],
    },
    alternates: {
        canonical: "https://cinemania.com/trending",
    },
};

const TrendingPage: FC = () => {
    return (
        <>
            <h1 className="text-2xl font-semibold">Trending Movies & TV Shows</h1>
            <TrendingFilters />
            <TrendingContainer />
        </>
    );
};

export default TrendingPage;