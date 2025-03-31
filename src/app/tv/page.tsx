import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { globalDefaultFilters } from "@/types/filters";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = {
    title: "TV Shows | Cinemania",
    description:
        "Explore the latest and trending TV shows on Cinemania. Get detailed information, ratings, and more.",
    openGraph: {
        title: "TV Shows | Cinemania",
        description:
            "Discover top-rated and trending TV shows with detailed info and reviews on Cinemania.",
        url: "https://cinemania.com/tv-shows",
        siteName: "Cinemania",
        images: [
            {
                url: "https://cinemania.com/og/tv-shows.jpg",
                width: 1200,
                height: 630,
                alt: "TV Shows on Cinemania",
            },
        ],
        type: "website",
    },
    robots: {
        index: true,
        follow: true,
    },
};

const TVPage: FC = () => {
    return (
        <FilterProvider defaultFilters={globalDefaultFilters}>
            <h1 className="font-semibold text-2xl">TV Shows</h1>
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

export default TVPage;
