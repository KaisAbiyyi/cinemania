import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { buildPageMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = buildPageMetadata({
    title: "Upcoming Movies",
    description:
        "Stay ahead with the latest upcoming movies on Cinemania. Get release dates, trailers, and more information on what's coming soon.",
    path: "/movie/upcoming",
});

const UPCOMING_DEFAULT_FILTERS = {
    sort_by: "popularity.desc",
    with_release_type: "2|3",
};

const UpcomingMoviePage: FC = () => {
    return (
        <FilterProvider defaultFilters={UPCOMING_DEFAULT_FILTERS} datePreset="movie-upcoming">
            <h1 className="font-semibold text-2xl">Upcoming Movies</h1>
            <div className="flex gap-4">
                <Link
                    href={"/movie/now-playing"}
                    className={buttonVariants({ variant: "outline", className: "bg-transparent" })}
                >
                    Now Playing
                </Link>
                <Link
                    href={"/movie/upcoming"}
                    className={buttonVariants({ variant: "default" })}
                >
                    Upcoming
                </Link>
                <Link
                    href={"/movie/top-rated"}
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

export default UpcomingMoviePage;
