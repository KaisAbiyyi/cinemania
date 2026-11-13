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
    title: "Top Rated TV Shows",
    description:
        "Discover the highest rated TV shows on Cinemania. Read reviews, ratings, and detailed information on critically acclaimed series.",
    path: "/tv/top-rated",
});

const TOP_RATED_TV_DEFAULT_FILTERS: Filters = {
    sort_by: "vote_average.desc",
    vote_count_gte: 300,
};

const TopRatedTVPage: FC = () => {
    return (
        <FilterProvider defaultFilters={TOP_RATED_TV_DEFAULT_FILTERS}>
            <h1 className="font-semibold text-2xl">Top Rated TV Shows</h1>
            <div className="flex gap-4">
                <Link
                    href="/tv/airing-today"
                    className={buttonVariants({ variant: "outline", className: "bg-transparent" })}
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
                    className={buttonVariants({ variant: "default" })}
                >
                    Top Rated
                </Link>
            </div>
            <FilterContainer mediaType="tv" />
            <MediaContainer mediaType="tv" />
        </FilterProvider>
    );
};

export default TopRatedTVPage;
