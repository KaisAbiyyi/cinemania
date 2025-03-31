import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { Filters } from "@/types/filters";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = {
    title: "On The Air TV Shows | Cinemania",
    description:
        "Stay updated with the latest on the air TV shows on Cinemania. Get episode details, release dates, and more information on what's currently streaming.",
    openGraph: {
        title: "On The Air TV Shows | Cinemania",
        description:
            "Explore on the air TV shows with comprehensive details, episode guides, and streaming info on Cinemania.",
        url: "https://cinemania.com/tv/on-the-air",
        siteName: "Cinemania",
        images: [
            {
                url: "https://cinemania.com/og/on-the-air.jpg",
                width: 1200,
                height: 630,
                alt: "On The Air TV Shows on Cinemania",
            },
        ],
        type: "website",
    },
    robots: {
        index: true,
        follow: true,
    },
};

const OnTheAirTVPage: FC = () => {
    const now = new Date();
    const oneWeekAfter = new Date(now);
    oneWeekAfter.setDate(now.getDate() + 7);

    // Default filter untuk halaman On The Air TV
    const defaultFilters: Filters = {
        air_date_gte: now.toISOString(),
        air_date_lte: oneWeekAfter.toISOString(),
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

    return (
        <FilterProvider defaultFilters={defaultFilters}>
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
