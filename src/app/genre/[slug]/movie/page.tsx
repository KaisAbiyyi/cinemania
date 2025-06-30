import MediaByGenre from "@/feature/media/components/genre/MediaByGenre";
import { slugToTitle } from "@/lib/utils";
import { FC } from "react";

interface MovieGenrePageProps {
    params: Promise<{
        slug: string;
    }>;
}

export const generateMetadata = async ({ params }: MovieGenrePageProps) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const genreTitle = slugToTitle(decodedSlug);

    return {
        title: `${genreTitle} Movies | Cinemania`,
        description: `Explore the genre of ${genreTitle} movies. Discover the best ${genreTitle} films and shows.`,
        keywords: `${genreTitle}, movies, genre, Cinemania`,
        openGraph: {
            title: `Genre - ${genreTitle} - Cinemania`,
            description: `Explore the genre of ${genreTitle} movies. Discover the best ${genreTitle} films and shows.`,
            type: "website",
            url: `https://yourdomain.com/genre/${slug}`,
        },
    };
};

const MovieGenrePage: FC<MovieGenrePageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const genreTitle = slugToTitle(decodedSlug);
    const genreId = slug.split("-")[0]
    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold">{genreTitle} Movies</h1>
            <MediaByGenre id={Number(genreId)} mediaType="movie" />
        </div>
    );
};

export default MovieGenrePage;