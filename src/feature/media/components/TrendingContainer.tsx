// TrendingContainer.tsx
"use client";

import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { cn } from "@/lib/utils";
import { FC, useMemo } from "react";
import { useInfiniteScrollObserver } from "../hooks/useInfiniteScrollObserver";
import { useInfiniteTrending } from "../hooks/useTrending";
import { useTrendingFilters } from "../hooks/useTrendingFilters";
import { dedupeInfinitePages } from "../utils/mediaPagination";
import MediaCard from "./MediaCard";
import MediaContainerSkeleton from "./skeletons/MediaContainerSkeleton";
import TrendingLoadMoreSkeleton from "./skeletons/TrendingLoadMoreSkeleton";

const GRID_CLASSES: Record<"horizontal" | "vertical", string> = {
    horizontal: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
    vertical: "grid-cols-1 lg:grid-cols-2",
};

const ITEMS_PER_PAGE = 20;

function resolveTrendingMediaType(
    item: { media_type?: string; first_air_date?: string; release_date?: string },
    filterMediaType: "all" | "movie" | "tv"
): "movie" | "tv" {
    if (item.media_type === "movie" || item.media_type === "tv") {
        return item.media_type;
    }
    if (filterMediaType === "movie" || filterMediaType === "tv") {
        return filterMediaType;
    }
    return item.first_air_date && !item.release_date ? "tv" : "movie";
}

const TrendingContainer: FC = () => {
    const { mediaType, timeWindow, orientation } = useTrendingFilters();

    const {
        data,
        isLoading,
        error,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
    } = useInfiniteTrending({
        mediaType,
        timeWindow,
        language: "en-US",
    });

    const loadMoreRef = useInfiniteScrollObserver({
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
        pageCount: data?.pages?.length ?? 0,
        fetchNextPage,
    });

    const items = useMemo(
        () =>
            dedupeInfinitePages(
                data?.pages,
                (item) => `${resolveTrendingMediaType(item, mediaType)}-${item.id}`
            ),
        [data?.pages, mediaType]
    );

    if (isLoading) {
        return (
            <div role="status" aria-label="Loading trending media">
                <MediaContainerSkeleton orientation={orientation} />
                <span className="sr-only">Loading trending media...</span>
            </div>
        );
    }

    if (error && !isFetchNextPageError) {
        return (
            <ErrorState
                message={error.message || "Failed to load trending media."}
                onRetry={() => void refetch()}
            />
        );
    }

    if (items.length === 0) {
        return (
            <EmptyState
                title="No trending results"
                message="No trending titles matched the selected filter combination."
            />
        );
    }

    const gridClass = cn("grid gap-4", GRID_CLASSES[orientation]);

    return (
        <div className="flex flex-col gap-6">
            <section className={gridClass}>
                {items.map((item) => {
                    const resolvedType = resolveTrendingMediaType(item, mediaType);
                    return (
                        <MediaCard
                            key={`${resolvedType}-${item.id}`}
                            id={item.id}
                            mediaType={resolvedType}
                            posterPath={item.poster_path}
                            rating={item.vote_average}
                            releaseDate={item.release_date || item.first_air_date}
                            title={item.title || item.name}
                            layout={orientation}
                            description={item.overview}
                            genre_ids={item.genre_ids}
                        />
                    );
                })}

                {isFetchingNextPage && (
                    <TrendingLoadMoreSkeleton
                        orientation={orientation}
                        itemsPerPage={ITEMS_PER_PAGE}
                    />
                )}
            </section>

            {isFetchNextPageError && (
                <ErrorState
                    message="Failed to load more trending results."
                    onRetry={() => void fetchNextPage()}
                />
            )}

            {hasNextPage && !isFetchNextPageError && (
                <div
                    ref={loadMoreRef}
                    className="h-4 w-full"
                    aria-hidden="true"
                />
            )}
        </div>
    );
};

export default TrendingContainer;