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
    title: "Airing Today TV Shows",
    description:
        "Discover the TV shows airing today on Cinemania. Get showtimes, ratings, reviews, and detailed information on the latest episodes currently streaming.",
    path: "/tv/airing-today",
});

const AIRING_TODAY_DEFAULT_FILTERS: Filters = {
    sort_by: "popularity.desc",
};

const AiringTodayTVPage: FC = () => {
    return (
        <FilterProvider defaultFilters={AIRING_TODAY_DEFAULT_FILTERS} datePreset="tv-airing-today">
            <h1 className="font-semibold text-2xl">Airing Today TV Shows</h1>
            <div className="flex gap-4">
                <Link
                    href="/tv/airing-today"
                    className={buttonVariants({ variant: "default" })}
                >
                    Airing Today
                </Link>
                <Link
                    href="/tv/on-tv"
                    className={buttonVariants({ variant: "outline", className: "bg-transparent" })}
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

export default AiringTodayTVPage;
