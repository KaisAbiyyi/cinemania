import DetailBackBanner from "@/feature/media/components/detail/DetailBackBanner";
import MediaVideosWrapper from "@/feature/media/components/videos/MediaVideosWrapper";
import { slugToTitle } from "@/lib/utils";
import { FC } from "react";

interface VideosPageProps {
    params: {
        slug: string
    }
}

export const generateMetadata = async ({ params }: { params: { slug: string } }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const tvTitle = slugToTitle(decodedSlug);

    return {
        title: `Videos of ${tvTitle} - Cinemania`,
        description: `Watch videos of ${tvTitle}. Discover trailers, behind-the-scenes, and more.`,
        keywords: `${tvTitle}, tv videos, trailers, behind-the-scenes, Cinemania`,
        openGraph: {
            title: `Videos of ${tvTitle} - Cinemania`,
            description: `Watch videos of ${tvTitle}. Discover trailers, behind-the-scenes, and more.`,
            type: "website",
            url: `https://yourdomain.com/tv/${slug}/videos`,
        },
    };
}

const VideosPage: FC<VideosPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);

    return (
        <div className="flex flex-col gap-8">
            <DetailBackBanner mediaType="tv" id={Number(decodedSlug.split("-")[0])} title={slugToTitle(decodedSlug)} context="All Videos" slug={slug} />
            <MediaVideosWrapper id={Number(decodedSlug.split("-")[0])} mediaType="tv" />
        </div>
    );
}

export default VideosPage;