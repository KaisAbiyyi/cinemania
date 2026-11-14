import DetailBackBanner from "@/feature/media/components/detail/DetailBackBanner";
import MediaReviewsWrapper from "@/feature/media/components/reviews/MediaReviewsWrapper";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import type { Metadata } from "next";
import { FC } from "react";

interface ReviewsPageProps {
    params: Promise<{
        slug: string
    }>
}

export const generateMetadata = async ({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const tvTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: `Reviews of ${tvTitle}`,
        description: `Read reviews of ${tvTitle}. Discover what critics and audiences are saying about the TV show.`,
        path: `/tv/${slug}/reviews`,
        keywords: `${tvTitle}, tv reviews, critics, audience, Cinemania`,
    });
}

const ReviewsPage: FC<ReviewsPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);

    return (
        <div className="flex flex-col gap-6">
            <DetailBackBanner mediaType="tv" id={Number(decodedSlug.split("-")[0])} title={slugToTitle(decodedSlug)} context="All Reviews" slug={slug} />
            <MediaReviewsWrapper id={Number(decodedSlug.split("-")[0])} mediaType="tv" />
        </div>
    );
}

export default ReviewsPage;
