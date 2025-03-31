import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider"; // pastikan path ini sesuai

export const metadata: Metadata = {
    title: "Top Rated Movies | Cinemania",
    description:
        "Discover the highest rated movies on Cinemania. Read reviews, ratings, and detailed information on critically acclaimed films.",
    openGraph: {
        title: "Top Rated Movies | Cinemania",
        description:
            "Explore top rated movies with comprehensive details, reviews, and ratings on Cinemania.",
        url: "https://cinemania.com/movie/top-rated",
        siteName: "Cinemania",
        images: [
            {
                url: "https://cinemania.com/og/top-rated.jpg",
                width: 1200,
                height: 630,
                alt: "Top Rated Movies on Cinemania",
            },
        ],
        type: "website",
    },
    robots: {
        index: true,
        follow: true,
    },
};


const TopRatedMoviePage: FC = () => {
    const defaultFilters = {
        sort_by: "vote_average.desc",
        without_genres: "99,10755",
        vote_count_gte: 300
    };

    return (
        <FilterProvider defaultFilters={defaultFilters}>
            <h1 className="font-semibold text-2xl">Top Rated Movies</h1>
            <div className="flex gap-4">
                <Link
                    href={"/movie/now-playing"}
                    className={buttonVariants({
                        variant: "outline",
                        className: "bg-transparent",
                    })}
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
                        variant: "default",
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

export default TopRatedMoviePage;
