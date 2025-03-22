"use client";

import { cn } from "@/lib/utils";
import { FC, HTMLAttributes } from "react";
import { MediaQueryParams, useMedia } from "../hooks/useMedia";
import MediaCard from "./MediaCard";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import MediaScrollableListSkeleton from "./MediaScrollableListSkeleton";

interface MediaScrollableListProps extends HTMLAttributes<HTMLDivElement> {
    title: string;
    redirectTo?: string;
    orientation: "vertical" | "horizontal";
    redirectToButtonVariant?: "default" | "ghost"
    type: "movie" | "tv";
    queryParams?: Partial<MediaQueryParams>; // Parameter tambahan untuk filtering, paging, dll.
    className?: string;
    showOnly?: number; // New parameter to limit the number of items shown
}

const MediaScrollableList: FC<MediaScrollableListProps> = ({
    title,
    redirectTo,
    orientation = "horizontal",
    redirectToButtonVariant = "ghost",
    type,
    queryParams = {},
    className,
    showOnly, // Add the new parameter
    ...props
}) => {
    // Gabungkan parameter dasar dengan queryParams tambahan
    const baseParams: MediaQueryParams = {
        mediaType: type,
        language: "en-US",
        include_adults: false,
        ...queryParams,
    };

    const { data, isLoading, error } = useMedia(baseParams);

    if (isLoading) return <MediaScrollableListSkeleton className={className} title={title} redirectTo={redirectTo} orientation={orientation} />;
    if (error) return <div>Error fetching media</div>;

    // Get all media items
    const allMediaItems = data?.results || [];

    // Apply the showOnly limit if specified
    const mediaItems = showOnly ? allMediaItems.slice(0, showOnly) : allMediaItems;

    return (
        <section {...props} className={cn("flex flex-col gap-6", !title && "-mt-12")}>
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">{title}</h1>
                {redirectTo && (
                    <Link href={`/${redirectTo}`} className={buttonVariants({ variant: redirectToButtonVariant, className: "w-fit" })}>
                        More
                        <ChevronRight />
                    </Link>
                )}
            </div>
            <div className={cn("gap-4 flex", orientation === "vertical" ? " flex-col overflow-y-auto" : "overflow-x-auto pb-6", className)}>
                {mediaItems.map((media: any) => (
                    <MediaCard
                        className={orientation === "horizontal" ? "min-w-52" : ""}
                        key={media.id}
                        id={media.id}
                        title={media.title || media.name}
                        posterPath={media.poster_path}
                        rating={media.vote_average}
                        releaseDate={media.release_date || media.first_air_date}
                        mediaType={type}
                        description={media.overview}
                        genre_ids={media.genre_ids}
                        layout={orientation}
                    />
                ))}
            </div>
        </section>
    );
};

export default MediaScrollableList;