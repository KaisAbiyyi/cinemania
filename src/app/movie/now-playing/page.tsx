import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider"; // pastikan path ini sesuai

export const metadata: Metadata = {
    title: "Now Playing Movies | Cinemania",
    description:
        "Discover the latest now playing movies on Cinemania. Get showtimes, ratings, reviews, and detailed information on movies currently in theaters.",
    openGraph: {
        title: "Now Playing Movies | Cinemania",
        description:
            "Explore now playing movies with comprehensive details, reviews, and ratings on Cinemania.",
        url: "https://cinemania.com/movie/now-playing",
        siteName: "Cinemania",
        images: [
            {
                url: "https://cinemania.com/og/now-playing.jpg",
                width: 1200,
                height: 630,
                alt: "Now Playing Movies on Cinemania",
            },
        ],
        type: "website",
    },
    robots: {
        index: true,
        follow: true,
    },
};

const NowPlayingMoviePage: FC = () => {
    const now = new Date();
    const oneMonthBefore = new Date(now);
    oneMonthBefore.setMonth(now.getMonth() - 1);

    const defaultFilters = {
        release_date_gte: oneMonthBefore.toISOString(),
        release_date_lte: now.toISOString(),
        sort_by: "popularity.desc",
        with_release_type: "2|3",
    };

    return (
        <FilterProvider defaultFilters={defaultFilters}>
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
