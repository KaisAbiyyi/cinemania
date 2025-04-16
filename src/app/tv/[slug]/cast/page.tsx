import { FC } from "react";
import { Metadata } from "next";
import { slugToTitle } from "@/lib/utils";
import MediaCastWrapper from "@/feature/media/components/cast/MediaCastWrapper";
import CastBanner from "@/feature/media/components/detail/DetailBackBanner";

interface CastPageProps {
    params: {
        slug: string;
    };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const tvTitle = slugToTitle(decodedSlug);

    return {
        title: `Cast of ${tvTitle} - Cinemania`,
        description: `Explore the full cast of ${tvTitle}. Discover the actors and crew who brought the tv to life.`,
        keywords: `${tvTitle}, TV cast, actors, crew, Cinemania`,
        openGraph: {
            title: `Cast of ${tvTitle} - Cinemania`,
            description: `Explore the full cast of ${tvTitle}. Discover the actors and crew who brought the tv to life.`,
            type: "website",
            url: `https://yourdomain.com/tv/${slug}/cast`,
        },
    };
}

const CastPage: FC<CastPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);

    // Extract mediaType and id from pathname
    const [id, ...titleParts] = decodedSlug.split("-");
    const title = slugToTitle(titleParts.join("-"));

    return (
        <div className="flex flex-col gap-6">
            <CastBanner mediaType="tv" id={Number(id)} title={title} slug={slug} context="Full Cast and Crew" />
            <MediaCastWrapper id={Number(id)} />
        </div>
    );
};

export default CastPage;