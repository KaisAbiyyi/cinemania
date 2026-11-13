import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { buildPageMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { globalDefaultFilters } from "@/types/filters";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = buildPageMetadata({
    title: "Movies",
    description:
        "Explore the latest and trending movies on Cinemania. Get detailed information, ratings, and more.",
    path: "/movie",
});

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
