"use client"

import { FC, useEffect, useRef } from "react";
import { useInfiniteMedia } from "../../hooks/useMedia";
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

const MediaByGenre: FC<MediaByGenreProps> = ({ id, mediaType }) => {
    const searchParams = useSearchParams();
    const router = useRouter();

    // Get initial sort value from URL or default to the first option
    const sortBy = searchParams.get("sort_by") || SORT_OPTIONS[0].value;

    const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteMedia({ mediaType, with_genres: id, sort_by: sortBy });
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    const handleSortChange = (value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("sort_by", value);
        router.push(`?${params.toString()}`);
    };

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            },
            { threshold: 0.1, rootMargin: "100px" }
        );

        const current = loadMoreRef.current;
        if (current) observer.observe(current);

        return () => {
            if (current) observer.unobserve(current);
            observer.disconnect();
        };
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

    return (
        <div className="flex flex-col gap-6">
            <Select value={sortBy} onValueChange={handleSortChange}>
                <SelectTrigger className="w-48">
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
                <MediaByGenreSkeleton />
            ) : error || !data ? (
                <p>There was an error retrieving the data</p>
            ) : (
                <>
                    {data.pages.map((page, pageIndex) => (
                        <div key={pageIndex} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {page.results.map((media) => (
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
                    ))}
                    {isFetchingNextPage && <p className="text-center">Loading more...</p>}
                    {hasNextPage && <div ref={loadMoreRef} className="w-full h-4" aria-hidden="true" />}
                </>
            )}
        </div>
    );
};

export default MediaByGenre;