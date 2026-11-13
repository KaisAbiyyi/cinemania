import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { buildPageMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { Filters } from "@/types/filters";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = buildPageMetadata({
    title: "On The Air TV Shows",
    description:
        "Stay updated with the latest on the air TV shows on Cinemania. Get episode details, release dates, and more information on what's currently streaming.",
    path: "/tv/on-tv",
});

const ON_THE_AIR_DEFAULT_FILTERS: Filters = {
    sort_by: "popularity.desc",
    vote_average_gte: 0,
    vote_average_lte: 10,
    vote_count_gte: 0,
    watch_region: "",
    with_genres: "",
    with_keywords: "",
    with_original_language: "",
    with_runtime_gte: 0,
    with_runtime_lte: 360,
    with_watch_providers: "",
};

const OnTheAirTVPage: FC = () => {
    return (
        <FilterProvider defaultFilters={ON_THE_AIR_DEFAULT_FILTERS} datePreset="tv-on-tv">
            <h1 className="font-semibold text-2xl">On The Air TV Shows</h1>
            <div className="flex gap-4">
                <Link
                    href="/tv/airing-today"
                    className={buttonVariants({ variant: "outline", className: "bg-transparent" })}
                >
                    Airing Today
                </Link>
                <Link
                    href="/tv/on-tv"
                    className={buttonVariants({ variant: "default" })}
                >
                    On TV
                </Link>
                <Link
                    href="/tv/top-rated"
                    className={buttonVariants({ variant: "outline", className: "bg-transparent" })}
                >
                    Top Rated
                </Link>
            </div>
            <FilterContainer mediaType="tv" />
            <MediaContainer mediaType="tv" />
        </FilterProvider>
    );
};

export default OnTheAirTVPage;
