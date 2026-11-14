import MediaByKeyword from "@/feature/media/components/keyword/MediaByKeyword";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import type { Metadata } from "next";
import { FC } from "react";

interface MovieKeywordPageProps {
    params: Promise<{
        slug: string;
    }>;
}

export const generateMetadata = async ({ params }: MovieKeywordPageProps): Promise<Metadata> => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const keywordTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: `${keywordTitle} Movies`,
        description: `Explore the keyword of ${keywordTitle} movies. Discover the best ${keywordTitle} films and shows.`,
        path: `/keyword/${slug}/movie`,
        keywords: `${keywordTitle}, movies, keyword, Cinemania`,
    });
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
