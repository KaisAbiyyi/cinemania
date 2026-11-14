import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { buildPageMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = buildPageMetadata({
    title: "Now Playing Movies",
    description:
        "Discover the latest now playing movies on Cinemania. Get showtimes, ratings, reviews, and detailed information on movies currently in theaters.",
    path: "/movie/now-playing",
});

const NOW_PLAYING_DEFAULT_FILTERS = {
    sort_by: "popularity.desc",
    with_release_type: "2|3",
};

const NowPlayingMoviePage: FC = () => {
    return (
        <FilterProvider defaultFilters={NOW_PLAYING_DEFAULT_FILTERS} datePreset="movie-now-playing">
            <h1 className="font-semibold text-2xl">Now Playing Movies</h1>
            <div className="flex gap-4">
                <Link
                    href={"/movie/now-playing"}
                    className={buttonVariants({ variant: "default" })}
                >
                    Now Playing
                </Link>
                <Link
                    href={"/movie/upcoming"}
                    className={buttonVariants({
                        variant: "outline",
                        className: "bg-transparent",
                    })}
                >
                    Upcoming
                </Link>
                <Link
                    href={"/movie/top-rated"}
                    className={buttonVariants({
                        variant: "outline",
                        className: "bg-transparent",
                    })}
                >
                    Top Rated
                </Link>
            </div>
            <FilterContainer mediaType="movie" />
            <MediaContainer mediaType="movie" />
        </FilterProvider>
    );
};

export default NowPlayingMoviePage;
