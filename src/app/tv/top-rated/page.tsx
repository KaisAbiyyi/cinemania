import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { Filters } from "@/types/filters";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = {
    title: "Top Rated TV Shows | Cinemania",
    description:
        "Discover the highest rated TV shows on Cinemania. Read reviews, ratings, and detailed information on critically acclaimed series.",
    openGraph: {
        title: "Top Rated TV Shows | Cinemania",
        description:
            "Explore top rated TV shows with comprehensive details, reviews, and ratings on Cinemania.",
        url: "https://cinemania.com/tv/top-rated",
        siteName: "Cinemania",
        images: [
            {
                url: "https://cinemania.com/og/top-rated-tv.jpg",
                width: 1200,
                height: 630,
                alt: "Top Rated TV Shows on Cinemania",
            },
        ],
        type: "website",
    },
    robots: {
        index: true,
        follow: true,
    },
};

const TopRatedTVPage: FC = () => {
    // Definisikan defaultFilters untuk halaman ini.
    const defaultFilters: Filters = {
        sort_by: "vote_average.desc",
        vote_count_gte:300
        // Jika ada parameter khusus lainnya untuk filter TV, tambahkan di sini.
    };

    return (
        <FilterProvider defaultFilters={defaultFilters}>
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
