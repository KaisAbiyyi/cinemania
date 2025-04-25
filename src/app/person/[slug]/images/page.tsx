import { buttonVariants } from "@/components/ui/button";
import DetailBackBanner from "@/feature/media/components/detail/DetailBackBanner";
import PersonImageWrapper from "@/feature/person/components/PersonImageWrapper";
import { slugToTitle } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { FC } from "react";

interface ImagesPageProps {
    params: {
        slug: string;
    };
}

export const generateMetadata = async ({ params }: { params: { slug: string } }) => {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const personName = slugToTitle(decodedSlug);

    return {
        title: `Images of ${personName} - Cinemania`,
        description: `Explore images of ${personName}. Discover behind-the-scenes, profiles, and more.`,
        keywords: `${personName}, person images, profiles, behind-the-scenes, Cinemania`,
        openGraph: {
            title: `Images of ${personName} - Cinemania`,
            description: `Explore images of ${personName}. Discover behind-the-scenes, profiles, and more.`,
            type: "website",
            url: `https://yourdomain.com/person/${slug}/images`,
        },
    };
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
