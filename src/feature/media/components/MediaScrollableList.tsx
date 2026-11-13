"use client";

import { cn } from "@/lib/utils";
import { DiscoveryDatePreset, resolveDiscoveryDatePresetQueryParams } from "@/lib/datePresets";
import { FC, HTMLAttributes, useMemo, useSyncExternalStore } from "react";
import { MediaQueryParams, useMedia } from "../hooks/useMedia";
import MediaCard from "./MediaCard";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import MediaScrollableListSkeleton from "./skeletons/MediaScrollableListSkeleton";

const emptySubscribe = () => () => {};

interface MediaScrollableListProps extends HTMLAttributes<HTMLDivElement> {
    title: string;
    redirectTo?: string;
    orientation: "vertical" | "horizontal";
    redirectToButtonVariant?: "default" | "ghost";
    type: "movie" | "tv";
    queryParams?: Partial<MediaQueryParams>;
    datePreset?: DiscoveryDatePreset;
    className?: string;
    showOnly?: number;
}

const MediaScrollableList: FC<MediaScrollableListProps> = ({
    title,
    redirectTo,
    orientation = "horizontal",
    redirectToButtonVariant = "ghost",
    type,
    queryParams = {},
    datePreset,
    className,
    showOnly,
    ...props
}) => {
    const isHydrated = useSyncExternalStore(
        emptySubscribe,
        () => true,
        () => false
    );

    const isReady = !datePreset || isHydrated;

    const presetQueryParams = useMemo<Record<string, string>>(
        () => (datePreset && isHydrated ? resolveDiscoveryDatePresetQueryParams(datePreset) : {}),
        [datePreset, isHydrated]
    );

    const baseParams: MediaQueryParams = {
        mediaType: type,
        language: "en-US",
        include_adult: false,
        ...queryParams,
        ...presetQueryParams,
    };

    const { data, isLoading, error } = useMedia(baseParams, { enabled: isReady });

    if (!isReady || isLoading) {
        return <MediaScrollableListSkeleton className={className} title={title} redirectTo={redirectTo} orientation={orientation} />;
    }
    if (error) return <div>Error fetching media</div>;

    const allMediaItems = data?.results || [];
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
                {/* eslint-disable-next-line */}
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
