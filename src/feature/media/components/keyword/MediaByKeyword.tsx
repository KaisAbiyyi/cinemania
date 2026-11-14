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
import MediaByKeywordSkeleton from "../skeletons/MediaByGenreSkeleton";

interface MediaByKeywordProps {
    slug: string;
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

const MEDIA_TYPE_OPTIONS = [
    { value: "movie", label: "Movies" },
    { value: "tv", label: "TV Shows" },
];

const MediaByKeywordInner: FC<MediaByKeywordProps> = ({ slug, mediaType }) => {
    const searchParams = useSearchParams();
    const router = useRouter();

    // Extract id from slug (preserving full slug remainder safely)
    const dashIndex = slug.indexOf("-");
    const id = dashIndex >= 0 ? slug.slice(0, dashIndex) : slug;

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
    } = useInfiniteMedia({ mediaType, with_keywords: Number(id), sort_by: sortBy });

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

    const handleMediaTypeChange = (value: string) => {
        const nextSearch = searchParams?.toString() ?? "";
        router.push(`/keyword/${slug}/${value}${nextSearch ? `?${nextSearch}` : ""}`);
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex gap-4">
                <Select value={sortBy} onValueChange={handleSortChange}>
                    <SelectTrigger aria-label="Sort keyword results" className="w-48">
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
                <Select value={mediaType} onValueChange={handleMediaTypeChange}>
                    <SelectTrigger aria-label="Keyword media type" className="w-48">
                        <SelectValue placeholder="Media Type" />
                    </SelectTrigger>
                    <SelectContent>
                        {MEDIA_TYPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {isLoading ? (
                <div role="status" aria-label="Loading keyword media">
                    <MediaByKeywordSkeleton />
                    <span className="sr-only">Loading keyword media...</span>
                </div>
            ) : (error && !isFetchNextPageError) || !data ? (
                <ErrorState
                    message={error?.message || "Failed to load keyword results."}
                    onRetry={() => void refetch()}
                />
            ) : items.length === 0 ? (
                <EmptyState
                    title="No titles found"
                    message={`No ${mediaType === "movie" ? "movies" : "TV shows"} were found for this keyword.`}
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

const MediaByKeyword: FC<MediaByKeywordProps> = (props) => (
    <Suspense fallback={<MediaByKeywordSkeleton />}>
        <MediaByKeywordInner {...props} />
    </Suspense>
);

export default MediaByKeyword;