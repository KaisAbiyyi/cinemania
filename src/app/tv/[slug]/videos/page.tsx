import DetailBackBanner from "@/feature/media/components/detail/DetailBackBanner";
import MediaVideosWrapper from "@/feature/media/components/videos/MediaVideosWrapper";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import type { Metadata } from "next";
import { FC } from "react";

interface VideosPageProps {
    params: Promise<{
        slug: string
    }>
}

export const generateMetadata = async ({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const tvTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: `Videos of ${tvTitle}`,
        description: `Watch videos of ${tvTitle}. Discover trailers, behind-the-scenes, and more.`,
        path: `/tv/${slug}/videos`,
        keywords: `${tvTitle}, tv videos, trailers, behind-the-scenes, Cinemania`,
    });
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
