import MediaByKeyword from "@/feature/media/components/keyword/MediaByKeyword";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import type { Metadata } from "next";
import { FC } from "react";

interface TVKeywordPageProps {
    params: Promise<{
        slug: string;
    }>;
}

export const generateMetadata = async ({ params }: TVKeywordPageProps): Promise<Metadata> => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const keywordTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: `${keywordTitle} TV Shows`,
        description: `Explore the keyword of ${keywordTitle} TV shows. Discover the best ${keywordTitle} TV shows and series.`,
        path: `/keyword/${slug}/tv`,
        keywords: `${keywordTitle}, TV shows, keyword, Cinemania`,
    });
};

const TVKeywordPage: FC<TVKeywordPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const keywordTitle = slugToTitle(decodedSlug);

    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold">{keywordTitle} TV Shows</h1>
            <MediaByKeyword slug={decodedSlug} mediaType="tv" />
        </div>
    );
};

export default TVKeywordPage;
