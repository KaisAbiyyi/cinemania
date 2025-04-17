import MediaByKeyword from "@/feature/media/components/keyword/MediaByKeyword";
import { slugToTitle } from "@/lib/utils";
import { FC } from "react";

interface TVKeywordPageProps {
    params: {
        slug: string;
    };
}

export const generateMetadata = async ({ params }: TVKeywordPageProps) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const keywordTitle = slugToTitle(decodedSlug);

    return {
        title: `${keywordTitle} TV Shows | Cinemania`,
        description: `Explore the keyword of ${keywordTitle} TV shows. Discover the best ${keywordTitle} TV shows and series.`,
        keywords: `${keywordTitle}, TV shows, keyword, Cinemania`,
        openGraph: {
            title: `Keyword - ${keywordTitle} - Cinemania`,
            description: `Explore the keyword of ${keywordTitle} TV shows. Discover the best ${keywordTitle} TV shows and series.`,
            type: "website",
            url: `https://yourdomain.com/keyword/${slug}`,
        },
    };
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