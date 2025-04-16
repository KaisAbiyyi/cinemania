import DetailBackBanner from "@/feature/media/components/detail/DetailBackBanner";
import MediaReviewsWrapper from "@/feature/media/components/reviews/MediaReviewsWrapper";
import { slugToTitle } from "@/lib/utils";
import { FC } from "react";

interface ReviewsPageProps {
    params: {
        slug: string
    }
}

export const generateMetadata = async ({ params }: { params: { slug: string } }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const movieTitle = slugToTitle(decodedSlug);

    return {
        title: `Reviews of ${movieTitle} - Cinemania`,
        description: `Read reviews of ${movieTitle}. Discover what critics and audiences are saying about the movie.`,
        keywords: `${movieTitle}, movie reviews, critics, audience, Cinemania`,
        openGraph: {
            title: `Reviews of ${movieTitle} - Cinemania`,
            description: `Read reviews of ${movieTitle}. Discover what critics and audiences are saying about the movie.`,
            type: "website",
            url: `https://yourdomain.com/movie/${slug}/reviews`,
        },
    };
}

const ReviewsPage: FC<ReviewsPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);



    return (
        <div className="flex flex-col gap-6">
            <DetailBackBanner mediaType="movie" id={Number(decodedSlug.split("-")[0])} title={slugToTitle(decodedSlug)} context="All Reviews" slug={slug} />
            <MediaReviewsWrapper id={Number(decodedSlug.split("-")[0])} mediaType="movie" />
        </div>
    );
}

export default ReviewsPage;