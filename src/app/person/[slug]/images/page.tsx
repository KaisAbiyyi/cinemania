import { buttonVariants } from "@/components/ui/button";
import PersonImageWrapper from "@/feature/person/components/PersonImageWrapper";
import { buildPageMetadata } from "@/lib/metadata";
import { slugToTitle } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FC } from "react";

interface ImagesPageProps {
    params: Promise<{
        slug: string;
    }>;
}

export const generateMetadata = async ({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const personName = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: `Images of ${personName}`,
        description: `Explore images of ${personName}. Discover behind-the-scenes, profiles, and more.`,
        path: `/person/${slug}/images`,
        keywords: `${personName}, person images, profiles, behind-the-scenes, Cinemania`,
    });
}

const ImagesPage: FC<ImagesPageProps> = async ({ params }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const id = Number(decodedSlug.split("-")[0]);
    const name = slugToTitle(decodedSlug);

    return (
        <div className="flex flex-col gap-8">
            <Link
                href={`/person/${slug}`}
                className={buttonVariants({ variant: "outline", className: "w-fit" })}
            >
                <ArrowLeft />
                Back to {name}
            </Link>
            <PersonImageWrapper id={id} />
        </div>
    );
}

export default ImagesPage;
