"use client"

import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { FC, Suspense, useMemo } from "react";
import { useInfiniteMedia } from "../../hooks/useMedia";
import { useInfiniteScrollObserver } from "../../hooks/useInfiniteScrollObserver";
import { dedupeInfinitePages } from "../../utils/mediaPagination";
import MediaCard from "../../components/MediaCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParams, useRouter } from "next/navigation";
import MediaByGenreSkeleton from "../skeletons/MediaByGenreSkeleton";

interface MediaByGenreProps {
    id: number;
    mediaType: "movie" | "tv";
}

const SORT_OPTIONS = [
    { value: "popularity.desc", label: "Popularity (Desc)" },
    { value: "popularity.asc", label: "Popularity (Asc)" },
    { value: "release_date.desc", label: "Release Date (Desc)" },
    { value: "release_date.asc", label: "Release Date (Asc)" },
    { value: "vote_average.desc", label: "Rating (Desc)" },
    { value: "vote_average.asc", label: "Rating (Asc)" },
];

const MediaByGenreInner: FC<MediaByGenreProps> = ({ id, mediaType }) => {
    const searchParams = useSearchParams();
    const router = useRouter();

    // Get initial sort value from URL or default to the first option
    const sortBy = searchParams?.get("sort_by") || SORT_OPTIONS[0].value;

    const {
        data,
        isLoading,
        error,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
    } = useInfiniteMedia({ mediaType, with_genres: id, sort_by: sortBy });

    const loadMoreRef = useInfiniteScrollObserver({
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
        pageCount: data?.pages?.length ?? 0,
        fetchNextPage,
    });

    const items = useMemo(
        () => dedupeInfinitePages(data?.pages, (item) => item.id),
        [data?.pages]
    );

    const handleSortChange = (value: string) => {
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        params.set("sort_by", value);
        router.push(`?${params.toString()}`);
    };

    return (
        <div className="flex flex-col gap-6">
            <Select value={sortBy} onValueChange={handleSortChange}>
                <SelectTrigger aria-label="Sort genre results" className="w-48">
                    <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                    {SORT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {isLoading ? (
                <div role="status" aria-label="Loading genre media">
                    <MediaByGenreSkeleton />
                    <span className="sr-only">Loading genre media...</span>
                </div>
            ) : (error && !isFetchNextPageError) || !data ? (
                <ErrorState
                    message={error?.message || "Failed to load genre results."}
                    onRetry={() => void refetch()}
                />
            ) : items.length === 0 ? (
                <EmptyState
                    title="No titles found"
                    message={`No ${mediaType === "movie" ? "movies" : "TV shows"} were found for this genre.`}
                />
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        {items.map((media) => (
                            <MediaCard
                                key={media.id}
                                id={media.id}
                                description={media.overview}
                                title={media.title || media.name}
                                posterPath={media.poster_path}
                                releaseDate={media.release_date || media.first_air_date}
                                rating={media.vote_average}
                                mediaType={mediaType}
                                genre_ids={media.genre_ids}
                                layout="vertical"
                            />
                        ))}
                    </div>
                    {isFetchingNextPage && (
                        <p role="status" className="text-center text-sm text-muted-foreground">
                            Loading more...
                        </p>
                    )}
                    {isFetchNextPageError && (
                        <ErrorState
                            message="Failed to load more results."
                            onRetry={() => void fetchNextPage()}
                        />
                    )}
                    {hasNextPage && !isFetchNextPageError && (
                        <div ref={loadMoreRef} className="w-full h-4" aria-hidden="true" />
                    )}
                </>
            )}
        </div>
    );
};

const MediaByGenre: FC<MediaByGenreProps> = (props) => (
    <Suspense fallback={<MediaByGenreSkeleton />}>
        <MediaByGenreInner {...props} />
    </Suspense>
);

export default MediaByGenre;