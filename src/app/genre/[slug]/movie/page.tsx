import MediaByGenre from "@/feature/media/components/genre/MediaByGenre";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import type { Metadata } from "next";
import { FC } from "react";

interface MovieGenrePageProps {
    params: Promise<{
        slug: string;
    }>;
}

export const generateMetadata = async ({ params }: MovieGenrePageProps): Promise<Metadata> => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const genreTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: `${genreTitle} Movies`,
        description: `Explore the genre of ${genreTitle} movies. Discover the best ${genreTitle} films and shows.`,
        path: `/genre/${slug}/movie`,
        keywords: `${genreTitle}, movies, genre, Cinemania`,
    });
};

const MovieGenrePage: FC<MovieGenrePageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const genreTitle = slugToTitle(decodedSlug);
    const genreId = slug.split("-")[0];

    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold">{genreTitle} Movies</h1>
            <MediaByGenre id={Number(genreId)} mediaType="movie" />
        </div>
    );
};

export default MovieGenrePage;
