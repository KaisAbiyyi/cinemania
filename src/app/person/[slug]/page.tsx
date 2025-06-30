import PersonWrapper from "@/feature/person/components/PersonWrapper";
import { slugToTitle } from "@/lib/utils";
import { FC } from "react";

interface PersonPageProps {
    params: Promise<{
        slug: string;
    }>
}

export const generateMetadata = async ({ params }: PersonPageProps) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const personTitle = slugToTitle(decodedSlug)

    return {
        title: `${personTitle} | Cinemania`,
        description: `Explore the profile of ${personTitle}. Discover their movies and TV shows.`,
        keywords: `${personTitle}, movies, TV shows, profile, Cinemania`,
        openGraph: {
            title: `Profile - ${personTitle} - Cinemania`,
            description: `Explore the profile of ${personTitle}. Discover their movies and TV shows.`,
            type: "website",
            url: `https://yourdomain.com/person/${slug}`,
        },
    };
}

const PersonPage: FC<PersonPageProps> = async ({ params }) => {
    const { slug } = await params;
    const personId = Number(slug.split("-")[0])

    return (
        <PersonWrapper personId={personId} />
    );
}

export default PersonPage;
