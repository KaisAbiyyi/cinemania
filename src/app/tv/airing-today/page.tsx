import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { Filters } from "@/types/filters";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = {
    title: "Airing Today TV Shows | Cinemania",
    description:
        "Discover the TV shows airing today on Cinemania. Get showtimes, ratings, reviews, and detailed information on the latest episodes currently streaming.",
    openGraph: {
        title: "Airing Today TV Shows | Cinemania",
        description:
            "Explore TV shows airing today with comprehensive details, reviews, and ratings on Cinemania.",
        url: "https://cinemania.com/tv/airing-today",
        siteName: "Cinemania",
        images: [
            {
                url: "https://cinemania.com/og/airing-today.jpg",
                width: 1200,
                height: 630,
                alt: "Airing Today TV Shows on Cinemania",
            },
        ],
        type: "website",
    },
    robots: {
        index: true,
        follow: true,
    },
};

const AiringTodayTVPage: FC = () => {
    const now = new Date();

    // Definisikan defaultFilters khusus untuk halaman ini.
    const defaultFilters: Filters = {
        air_date_gte: now.toISOString(),
        air_date_lte: now.toISOString(),
        sort_by: "popularity.desc",
    };

    return (
        <FilterProvider defaultFilters={defaultFilters}>
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
