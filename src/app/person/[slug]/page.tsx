import PersonWrapper from "@/feature/person/components/PersonWrapper";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import type { Metadata } from "next";
import { FC } from "react";

interface PersonPageProps {
    params: Promise<{
        slug: string;
    }>
}

export const generateMetadata = async ({ params }: PersonPageProps): Promise<Metadata> => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const personTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: personTitle,
        description: `Explore the profile of ${personTitle}. Discover their movies and TV shows.`,
        path: `/person/${slug}`,
        keywords: `${personTitle}, movies, TV shows, profile, Cinemania`,
    });
}

const PersonPage: FC<PersonPageProps> = async ({ params }) => {
    const { slug } = await params;
    const personId = Number(slug.split("-")[0]);

    return (
        <PersonWrapper personId={personId} />
    );
}

export default PersonPage;
