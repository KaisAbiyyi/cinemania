// TrendingContainer.tsx
"use client";

import { cn } from "@/lib/utils";
import { FC, useEffect, useRef } from "react";
import { useInfiniteTrending } from "../hooks/useTrending";
import { useTrendingFilters } from "../hooks/useTrendingFilters";
import MediaCard from "./MediaCard";
import TrendingContainerSkeleton from "./TrendingContainerSkeleton";
import TrendingLoadMoreSkeleton from "./TrendingLoadMoreSkeleton";

const GRID_CLASSES: Record<"horizontal" | "vertical", string> = {
    horizontal: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
    vertical: "grid-cols-1 lg:grid-cols-2",
};

const ITEMS_PER_PAGE = 20;

const TrendingContainer: FC = () => {
    const { mediaType, timeWindow, orientation } = useTrendingFilters();

    const {
        data,
        isLoading,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useInfiniteTrending({
        mediaType,
        timeWindow,
        language: "en-US",
    });

    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            },
            { threshold: 1 }
        );

        const currentRef = loadMoreRef.current;
        if (currentRef) observer.observe(currentRef);

        return () => {
            if (currentRef) observer.unobserve(currentRef);
        };
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

    if (isLoading) return <TrendingContainerSkeleton orientation={orientation} />;
    if (error) return <h1 className="text-center text-xl text-red-500">Failed to load media.</h1>;

    const gridClass = cn("grid gap-4", GRID_CLASSES[orientation]);

    return (
        <section className={gridClass}>
            {data?.pages.map((page, pageIndex) =>
                page.results.map((item) => (
                    <MediaCard
                        key={`${item.id}-${pageIndex}`}
                        id={item.id}
                        mediaType={item.media_type}
                        posterPath={item.poster_path}
                        rating={item.vote_average}
                        releaseDate={item.release_date || item.first_air_date}
                        title={item.title || item.name}
                        layout={orientation}
                        description={item.overview}
                        genre_ids={item.genre_ids}
                    />
                ))
            )}

            {isFetchingNextPage && (
                <TrendingLoadMoreSkeleton
                    orientation={orientation}
                    itemsPerPage={ITEMS_PER_PAGE}
                />
            )}

            {hasNextPage && (
                <div
                    ref={loadMoreRef}
                    className="h-4 w-full"
                    aria-hidden="true"
                />
            )}
        </section>
    );
};

export default TrendingContainer;