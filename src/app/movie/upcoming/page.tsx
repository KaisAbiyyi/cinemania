import { buttonVariants } from "@/components/ui/button";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import MediaContainer from "@/feature/media/components/MediaContainer";
import { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";
import { FilterProvider } from "@/feature/media/components/filter/FilterProvider";

export const metadata: Metadata = {
    title: "Upcoming Movies | Cinemania",
    description:
        "Stay ahead with the latest upcoming movies on Cinemania. Get release dates, trailers, and more information on what's coming soon.",
    openGraph: {
        title: "Upcoming Movies | Cinemania",
        description:
            "Explore upcoming movies with comprehensive details, trailers, and release info on Cinemania.",
        url: "https://cinemania.com/movie/upcoming",
        siteName: "Cinemania",
        images: [
            {
                url: "https://cinemania.com/og/upcoming.jpg",
                width: 1200,
                height: 630,
                alt: "Upcoming Movies on Cinemania",
            },
        ],
        type: "website",
    },
    robots: {
        index: true,
        follow: true,
    },
};

const UpcomingMoviePage: FC = () => {
    const now = new Date();
    const oneMonthAfter = new Date(now);
    oneMonthAfter.setMonth(now.getMonth() + 1);

    const defaultFilters = {
        release_date_gte: now.toISOString(),
        release_date_lte: oneMonthAfter.toISOString(),
        sort_by: "popularity.desc",
        with_release_type: "2|3"
    };

    return (
        <FilterProvider defaultFilters={defaultFilters}>
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
