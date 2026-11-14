import { FC } from "react";
import { Metadata } from "next";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import MediaCastWrapper from "@/feature/media/components/cast/MediaCastWrapper";
import CastBanner from "@/feature/media/components/detail/DetailBackBanner";

interface CastPageProps {
    params: Promise<{
        slug: string;
    }>;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const movieTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: `Cast of ${movieTitle}`,
        description: `Explore the full cast of ${movieTitle}. Discover the actors and crew who brought the movie to life.`,
        path: `/movie/${slug}/cast`,
        keywords: `${movieTitle}, movie cast, actors, crew, Cinemania`,
    });
}

const CastPage: FC<CastPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);

    // Extract mediaType and id from pathname
    const [id, ...titleParts] = decodedSlug.split("-");
    const title = slugToTitle(titleParts.join("-"));

    return (
        <div className="flex flex-col gap-6">
            <CastBanner mediaType="movie" id={Number(id)} title={title} slug={slug} context="Full Cast and Crew" />
            <MediaCastWrapper id={Number(id)} />
        </div>
    );
};

export default CastPage;
