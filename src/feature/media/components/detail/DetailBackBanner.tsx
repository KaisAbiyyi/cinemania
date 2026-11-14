"use client"

import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";

import { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMediaDetails } from "@/feature/media/hooks/useMediaDetails";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import DetailBackBannerSkeleton from "../skeletons/DetailBackBannerSkeleton";

interface DetailBackBannerProps {
    id: number;
    title: string;
    slug: string;
    context?: string;
    mediaType: "movie" | "tv";
}

const DetailBackBanner: FC<DetailBackBannerProps> = ({ id, title, slug, context, mediaType }) => {
    const { data: movieDetails, isLoading, error, refetch } = useMediaDetails({ id, mediaType });
    const imagePath = process.env.NEXT_PUBLIC_IMAGE_BASE_URL || "https://image.tmdb.org/t/p";

    if (isLoading) {
        return (
            <div role="status" aria-label="Loading title header">
                <DetailBackBannerSkeleton />
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                message={error.message || "Failed to load title details. Please try again later."}
                onRetry={() => void refetch()}
            />
        );
    }

    if (!movieDetails) {
        return <EmptyState title="Title unavailable" message="No details available for this title." />;
    }

    return (
        <div className="relative overflow-hidden rounded-lg">
            <Image
                src={movieDetails ? `${imagePath}/w500/${movieDetails.backdrop_path}` : `${imagePath}/original/default-backdrop.jpg`}
                alt={`${title} backdrop`}
                layout="fill"
                objectFit="cover"
                className="absolute inset-0 -z-10"
            />
            <div className="absolute inset-0 backdrop-blur-md bg-slate-950/70"></div>
            <div className="relative flex flex-col gap-4 p-4">
                <Link href={`/${mediaType}/${slug}`} className={buttonVariants({ variant: "secondary", className: "w-fit" })}>
                    <ArrowLeft />
                    Back to main
                </Link>
                <div className="flex items-end gap-4">
                    <Image
                        src={movieDetails ? `${imagePath}/w200/${movieDetails.poster_path}` : `${imagePath}/w200/default-poster.jpg`}
                        alt={title}
                        width={150}
                        height={200}
                        className="rounded-lg"
                    />
                    
                    <div className="text-white">
                        <h2 className="text-base font-semibold">{title} ({new Date(movieDetails?.release_date || movieDetails?.first_air_date).getFullYear()})</h2>
                        <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">{context}</h1>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DetailBackBanner;