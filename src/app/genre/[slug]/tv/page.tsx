import MediaByGenre from "@/feature/media/components/genre/MediaByGenre";
import { slugToTitle } from "@/lib/utils";
import { FC } from "react";

interface TVGenrePageProps {
    params: {
        slug: string;
    };
}

export const generateMetadata = async ({ params }: TVGenrePageProps) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const genreTitle = slugToTitle(decodedSlug);

    return {
        title: `${genreTitle} TV Shows | Cinemania`,
        description: `Explore the genre of ${genreTitle} TV shows. Discover the best ${genreTitle} TV shows and series.`,
        keywords: `${genreTitle}, TV shows, genre, Cinemania`,
        openGraph: {
            title: `Genre - ${genreTitle} - Cinemania`,
            description: `Explore the genre of ${genreTitle} TV shows. Discover the best ${genreTitle} TV shows and series.`,
            type: "website",
            url: `https://yourdomain.com/genre/${slug}`,
        },
    };
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