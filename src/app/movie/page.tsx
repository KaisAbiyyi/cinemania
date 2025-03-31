import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { globalDefaultFilters } from "@/types/filters";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = {
    title: "Movies | Cinemania",
    description:
        "Explore the latest and trending movies on Cinemania. Get detailed information, ratings, and more.",
    openGraph: {
        title: "Movies | Cinemania",
        description:
            "Discover top-rated and trending movies with detailed info and reviews on Cinemania.",
        url: "https://cinemania.com/movies",
        siteName: "Cinemania",
        images: [
            {
                url: "https://cinemania.com/og/movies.jpg",
                width: 1200,
                height: 630,
                alt: "Movies on Cinemania",
            },
        ],
        type: "website",
    },
    robots: {
        index: true,
        follow: true,
    },
};

const MoviePage: FC = () => {
    return (
        <FilterProvider defaultFilters={globalDefaultFilters}>
            <h1 className="font-semibold text-2xl">Movies</h1>
            <div className="flex gap-4">
                <Link
                    href="/movie/now-playing"
                    className={buttonVariants({ variant: "outline", className: "bg-transparent" })}
                >
                    Now Playing
                </Link>
                <Link
                    href="/movie/upcoming"
                    className={buttonVariants({ variant: "outline", className: "bg-transparent" })}
                >
                    Upcoming
                </Link>
                <Link
                    href="/movie/top-rated"
                    className={buttonVariants({ variant: "outline", className: "bg-transparent" })}
                >
                    Top Rated
                </Link>
            </div>
            <FilterContainer mediaType="movie" />
            <MediaContainer mediaType="movie" />
        </FilterProvider>
    );
};

export default MoviePage;
