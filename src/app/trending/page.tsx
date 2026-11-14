import TrendingContainer from "@/feature/media/components/TrendingContainer";
import TrendingFilters from "@/feature/media/components/filter/TrendingFilters";
import { buildPageMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { FC } from "react";

export const metadata: Metadata = buildPageMetadata({
    title: "Trending Movies & TV Shows",
    description:
        "Discover the latest trending movies and TV shows updated weekly. Stay up-to-date with the most popular content on Cinemania.",
    path: "/trending",
    keywords: [
        "trending movies",
        "trending tv shows",
        "popular movies",
        "best movies",
        "best tv shows",
        "Cinemania",
    ],
});

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
