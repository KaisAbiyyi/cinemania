import DetailBackBanner from "@/feature/media/components/detail/DetailBackBanner";
import MediaVideosWrapper from "@/feature/media/components/videos/MediaVideosWrapper";
import { slugToTitle } from "@/lib/utils";
import { FC } from "react";

interface VideosPageProps {
    params: Promise<{
        slug: string
    }>
}

export const generateMetadata = async ({ params }: { params: Promise<{ slug: string }> }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const movieTitle = slugToTitle(decodedSlug);

    return {
        title: `Videos of ${movieTitle} - Cinemania`,
        description: `Watch videos of ${movieTitle}. Discover trailers, behind-the-scenes, and more.`,
        keywords: `${movieTitle}, movie videos, trailers, behind-the-scenes, Cinemania`,
        openGraph: {
            title: `Videos of ${movieTitle} - Cinemania`,
            description: `Watch videos of ${movieTitle}. Discover trailers, behind-the-scenes, and more.`,
            type: "website",
            url: `https://yourdomain.com/movie/${slug}/videos`,
        },
    };
}

const VideosPage: FC<VideosPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);

    return (
        <div className="flex flex-col gap-8">
            <DetailBackBanner mediaType="movie" id={Number(decodedSlug.split("-")[0])} title={slugToTitle(decodedSlug)} context="All Videos" slug={slug} />
            <MediaVideosWrapper id={Number(decodedSlug.split("-")[0])} mediaType="movie" />
        </div>
    );
}

export default VideosPage;