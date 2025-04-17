import MediaByKeyword from "@/feature/media/components/keyword/MediaByKeyword";
import { slugToTitle } from "@/lib/utils";
import { FC } from "react";

interface MovieKeywordPageProps {
    params: {
        slug: string;
    };
}

export const generateMetadata = async ({ params }: MovieKeywordPageProps) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const keywordTitle = slugToTitle(decodedSlug);

    return {
        title: `${keywordTitle} Movies | Cinemania`,
        description: `Explore the keyword of ${keywordTitle} movies. Discover the best ${keywordTitle} films and shows.`,
        keywords: `${keywordTitle}, movies, keyword, Cinemania`,
        openGraph: {
            title: `Keyword - ${keywordTitle} - Cinemania`,
            description: `Explore the keyword of ${keywordTitle} movies. Discover the best ${keywordTitle} films and shows.`,
            type: "website",
            url: `https://yourdomain.com/keyword/${slug}`,
        },
    };
};

const MovieKeywordPage: FC<MovieKeywordPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const keywordTitle = slugToTitle(decodedSlug);
    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold">{keywordTitle} Movies</h1>
            <MediaByKeyword slug={decodedSlug} mediaType="movie" />
        </div>
    );
};

export default MovieKeywordPage;