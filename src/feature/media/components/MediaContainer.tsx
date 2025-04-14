"use client";

import { FC, useEffect, useRef } from "react";
import { useInfiniteMedia, MediaQueryParams } from "../hooks/useMedia";
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
    const { filters } = useFilterContext();
    const { orientation } = useTrendingFilters();

    // Bangun query dari global filter state
    const query: MediaQueryParams = buildMediaQueryParams(mediaType, filters);

    const {
        data,
        isLoading,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useInfiniteMedia(query);

    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            },
            { threshold: 0.1, rootMargin: '100px' }
        );

        const current = loadMoreRef.current;
        if (current) observer.observe(current);

        return () => {
            if (current) observer.unobserve(current);
            observer.disconnect(); // Tambahkan ini untuk memastikan observer dihapus
        };
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

    if (isLoading) return <MediaContainerSkeleton orientation={orientation} />;
    if (error)
        return (
            <h1 className="text-xl text-center text-red-500">
                Failed to load media.
            </h1>
        );

    const gridClass = cn("grid gap-4", GRID_CLASSES[orientation]);

    return (
        <section className={gridClass}>
            {data?.pages.map((page, pageIndex) =>
                page.results.map((item) => (
                    <MediaCard
                        key={`${item.id}-${pageIndex}`}
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
                ))
            )}

            {isFetchingNextPage && (
                <TrendingLoadMoreSkeleton
                    orientation={orientation}
                    itemsPerPage={ITEMS_PER_PAGE}
                />
            )}

            {hasNextPage && (
                <div ref={loadMoreRef} className="w-full h-4" aria-hidden="true" />
            )}
        </section>
    );
};

export default MediaContainer;
