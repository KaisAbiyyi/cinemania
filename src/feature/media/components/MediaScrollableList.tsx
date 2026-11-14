"use client";

import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { cn } from "@/lib/utils";
import {
    DiscoveryDatePreset,
    filtersToDiscoveryQueryParams,
    parseCalendarDateKey,
    resolveDiscoveryDatePresetFiltersForYmd,
} from "@/lib/datePresets";
import { FC, HTMLAttributes, useMemo, useSyncExternalStore } from "react";
import { MediaQueryParams, useMedia } from "../hooks/useMedia";
import { useLocalCalendarDay } from "../hooks/useLocalCalendarDay";
import { dedupeByKey } from "../utils/mediaPagination";
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
    const localCalendarDay = useLocalCalendarDay(Boolean(datePreset));

    const isReady = !datePreset || (isHydrated && Boolean(localCalendarDay));

    const presetQueryParams = useMemo<Record<string, string>>(() => {
        if (!datePreset || !localCalendarDay) {
            return {};
        }
        const ymd = parseCalendarDateKey(localCalendarDay);
        if (!ymd) {
            return {};
        }
        return filtersToDiscoveryQueryParams(
            resolveDiscoveryDatePresetFiltersForYmd(datePreset, ymd)
        );
    }, [datePreset, localCalendarDay]);

    const baseParams: MediaQueryParams = {
        mediaType: type,
        language: "en-US",
        include_adult: false,
        ...queryParams,
        ...presetQueryParams,
    };

    const { data, isLoading, error, refetch } = useMedia(baseParams, { enabled: isReady });

    const mediaItems = useMemo(() => {
        const deduped = dedupeByKey(data?.results ?? [], (item) => item.id);
        return showOnly ? deduped.slice(0, showOnly) : deduped;
    }, [data?.results, showOnly]);

    if (!isReady || isLoading) {
        return (
            <div role="status" aria-label={`Loading ${title || "media"}`}>
                <MediaScrollableListSkeleton className={className} title={title} redirectTo={redirectTo} orientation={orientation} />
                <span className="sr-only">Loading {title || "media"}...</span>
            </div>
        );
    }
    if (error) {
        return (
            <ErrorState
                message={error.message || `Failed to load ${title || "media"}.`}
                onRetry={() => void refetch()}
            />
        );
    }

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
            {mediaItems.length === 0 ? (
                <EmptyState message={`No ${title ? title.toLowerCase() : "media"} available.`} />
            ) : (
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
            )}
        </section>
    );
};

export default MediaScrollableList;
