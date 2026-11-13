import MediaByGenre from "@/feature/media/components/genre/MediaByGenre";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import type { Metadata } from "next";
import { FC } from "react";

interface TVGenrePageProps {
    params: Promise<{
        slug: string;
    }>;
}

export const generateMetadata = async ({ params }: TVGenrePageProps): Promise<Metadata> => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const genreTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: `${genreTitle} TV Shows`,
        description: `Explore the genre of ${genreTitle} TV shows. Discover the best ${genreTitle} TV shows and series.`,
        path: `/genre/${slug}/tv`,
        keywords: `${genreTitle}, TV shows, genre, Cinemania`,
    });
};

const TVGenrePage: FC<TVGenrePageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const genreTitle = slugToTitle(decodedSlug);
    const genreId = slug.split("-")[0];

    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold">{genreTitle} TV Shows</h1>
            <MediaByGenre id={Number(genreId)} mediaType="tv" />
        </div>
    );
};

export default TVGenrePage;
