"use client";

import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { FC, useMemo } from "react";
import { useInfiniteMedia, MediaQueryParams } from "../hooks/useMedia";
import { useInfiniteScrollObserver } from "../hooks/useInfiniteScrollObserver";
import { dedupeInfinitePages } from "../utils/mediaPagination";
import MediaCard from "./MediaCard";
import MediaContainerSkeleton from "./skeletons/MediaContainerSkeleton";
import TrendingLoadMoreSkeleton from "./skeletons/TrendingLoadMoreSkeleton";
import { cn } from "@/lib/utils";
import { useTrendingFilters } from "../hooks/useTrendingFilters";
import { buildMediaQueryParams, useFilterContext } from "./filter/FilterProvider";

// Grid layout berdasarkan orientasi
const GRID_CLASSES: Record<"horizontal" | "vertical", string> = {
    horizontal:
        "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
    vertical: "grid-cols-1 lg:grid-cols-2",
};

const ITEMS_PER_PAGE = 20;

interface MediaContainerProps {
    mediaType: "movie" | "tv";
}

const MediaContainer: FC<MediaContainerProps> = ({ mediaType }) => {
    // Ambil filter dari global context
    const { filters, isReady } = useFilterContext();
    const { orientation } = useTrendingFilters();

    // Bangun query dari global filter state
    const query: MediaQueryParams = buildMediaQueryParams(mediaType, filters);

    const {
        data,
        isLoading,
        error,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
    } = useInfiniteMedia(query, { enabled: isReady });

    const pageCount = data?.pages?.length ?? 0;
    const loadMoreRef = useInfiniteScrollObserver({
        enabled: isReady,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
        pageCount,
        fetchNextPage,
    });

    const items = useMemo(
        () => dedupeInfinitePages(data?.pages, (item) => item.id),
        [data?.pages]
    );

    if (!isReady || isLoading) {
        return (
            <div role="status" aria-label={`Loading ${mediaType === "movie" ? "movies" : "TV shows"}`}>
                <MediaContainerSkeleton orientation={orientation} />
                <span className="sr-only">
                    Loading {mediaType === "movie" ? "movies" : "TV shows"}...
                </span>
            </div>
        );
    }

    if (error && !isFetchNextPageError) {
        return (
            <ErrorState
                message={error.message || `Failed to load ${mediaType === "movie" ? "movies" : "TV shows"}.`}
                onRetry={() => void refetch()}
            />
        );
    }

    if (items.length === 0) {
        return (
            <EmptyState
                title="No results found"
                message={`No ${mediaType === "movie" ? "movies" : "TV shows"} match the selected filters.`}
            />
        );
    }

    const gridClass = cn("grid gap-4", GRID_CLASSES[orientation]);

    return (
        <div className="flex flex-col gap-6">
            <section className={gridClass}>
                {items.map((item) => (
                    <MediaCard
                        key={item.id}
                        id={item.id}
                        mediaType={mediaType}
                        posterPath={item.poster_path}
                        rating={item.vote_average}
                        releaseDate={item.release_date || item.first_air_date}
                        title={item.title || item.name}
                        layout={orientation}
                        description={item.overview}
                        genre_ids={item.genre_ids}
                    />
                ))}

                {isFetchingNextPage && (
                    <TrendingLoadMoreSkeleton
                        orientation={orientation}
                        itemsPerPage={ITEMS_PER_PAGE}
                    />
                )}
            </section>

            {isFetchNextPageError && (
                <ErrorState
                    message="Failed to load more results."
                    onRetry={() => void fetchNextPage()}
                />
            )}

            {hasNextPage && !isFetchNextPageError && (
                <div ref={loadMoreRef} className="w-full h-4" aria-hidden="true" />
            )}
        </div>
    );
};

export default MediaContainer;
