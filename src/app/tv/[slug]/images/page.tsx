import DetailBackBanner from "@/feature/media/components/detail/DetailBackBanner";
import MediaImagesWrapper from "@/feature/media/components/images/MediaImagesWrapper";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import type { Metadata } from "next";
import { FC } from "react";

interface ImagesPageProps {
    params: Promise<{
        slug: string;
    }>;
}

export const generateMetadata = async ({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const tvTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: `Images of ${tvTitle}`,
        description: `Explore images of ${tvTitle}. Discover behind-the-scenes, posters, and more.`,
        path: `/tv/${slug}/images`,
        keywords: `${tvTitle}, tv images, posters, behind-the-scenes, Cinemania`,
    });
}

const ImagesPage: FC<ImagesPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const id = Number(decodedSlug.split("-")[0]);
    const title = slugToTitle(decodedSlug);

    return (
        <div className="flex flex-col gap-8">
            <DetailBackBanner mediaType="tv" id={id} title={title} context="All Images" slug={slug} />
            <MediaImagesWrapper id={id} mediaType="tv" />
        </div>
    );
}

export default ImagesPage;
