"use client";

import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MediaCard from "@/feature/media/components/MediaCard";
import CastCard from "@/feature/media/components/cast/CastCard";
import { dedupeInfinitePages } from "@/feature/media/utils/mediaPagination";
import { slugify } from "@/lib/utils";
import Link from "next/link";
import { FC } from "react";
import { useSearch } from "../hooks/useSearch";
import SearchWrapperSkeleton from "./skeletons/SearchWrapperSkeleton";

interface Props {
    query: string;
}

const SearchWrapper: FC<Props> = ({ query }) => {
    const trimmedQuery = query.trim();
    const movieQuery = useSearch(trimmedQuery, "movie");
    const tvQuery = useSearch(trimmedQuery, "tv");
    const peopleQuery = useSearch(trimmedQuery, "person");
    const keywordQuery = useSearch(trimmedQuery, "keyword");

    if (!trimmedQuery) {
        return (
            <EmptyState
                title="Search Cinemania"
                message="Enter a movie, TV show, person, or keyword query to see results."
            />
        );
    }

    const renderLoadMore = (
        fetchNextPage: () => Promise<unknown> | unknown,
        hasNextPage: boolean | undefined,
        isFetchingNextPage: boolean,
        isFetchNextPageError: boolean
    ) => {
        if (isFetchNextPageError) {
            return (
                <div className="mt-4">
                    <ErrorState
                        message="Failed to load more search results."
                        onRetry={() => {
                            if (!isFetchingNextPage) {
                                void fetchNextPage();
                            }
                        }}
                    />
                </div>
            );
        }
        if (!hasNextPage) return null;
        return (
            <div className="flex justify-center mt-4">
                <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                        if (!isFetchingNextPage) {
                            void fetchNextPage();
                        }
                    }}
                    disabled={isFetchingNextPage}
                >
                    {isFetchingNextPage ? "Loading..." : "Load More"}
                </Button>
            </div>
        );
    };

    if (movieQuery.isLoading || tvQuery.isLoading || peopleQuery.isLoading || keywordQuery.isLoading) {
        return (
            <div role="status" aria-label="Loading search results">
                <SearchWrapperSkeleton />
                <span className="sr-only">Loading search results...</span>
            </div>
        );
    }

    const allErrored =
        Boolean(movieQuery.error && !movieQuery.isFetchNextPageError) &&
        Boolean(tvQuery.error && !tvQuery.isFetchNextPageError) &&
        Boolean(peopleQuery.error && !peopleQuery.isFetchNextPageError) &&
        Boolean(keywordQuery.error && !keywordQuery.isFetchNextPageError);

    if (allErrored) {
        return (
            <ErrorState
                message="Failed to load search results. Please try again later."
                onRetry={() => {
                    void movieQuery.refetch();
                    void tvQuery.refetch();
                    void peopleQuery.refetch();
                    void keywordQuery.refetch();
                }}
            />
        );
    }

    const movies = dedupeInfinitePages(movieQuery.data?.pages, (item: { id: number }) => item.id);
    const tvShows = dedupeInfinitePages(tvQuery.data?.pages, (item: { id: number }) => item.id);
    const people = dedupeInfinitePages(peopleQuery.data?.pages, (item: { id: number }) => item.id);
    const keywords = dedupeInfinitePages(keywordQuery.data?.pages, (item: { id: number }) => item.id);

    return (
        <Tabs defaultValue="movie" className="w-full">
            <TabsList>
                <TabsTrigger value="movie">
                    Movies ({movieQuery.data?.pages[0]?.total_results || 0})
                </TabsTrigger>
                <TabsTrigger value="tv">
                    TV ({tvQuery.data?.pages[0]?.total_results || 0})
                </TabsTrigger>
                <TabsTrigger value="person">
                    People ({peopleQuery.data?.pages[0]?.total_results || 0})
                </TabsTrigger>
                <TabsTrigger value="keyword">
                    Keywords ({keywordQuery.data?.pages[0]?.total_results || 0})
                </TabsTrigger>
            </TabsList>

            {/* Movies Tab */}
            <TabsContent value="movie" className="mt-4">
                {movieQuery.error && !movieQuery.isFetchNextPageError ? (
                    <ErrorState
                        message="Failed to load movie search results."
                        onRetry={() => void movieQuery.refetch()}
                    />
                ) : movies.length === 0 ? (
                    <EmptyState
                        title="No movies found"
                        message={`No movies matched "${trimmedQuery}".`}
                    />
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                            {/* eslint-disable-next-line */}
                            {movies.map((movie: any) => (
                                <MediaCard
                                    key={movie.id}
                                    id={movie.id}
                                    title={movie.title}
                                    posterPath={movie.poster_path}
                                    rating={movie.vote_average || 0}
                                    releaseDate={movie.release_date}
                                    mediaType="movie"
                                    genre_ids={movie.genre_ids}
                                    layout="horizontal"
                                />
                            ))}
                        </div>
                        {renderLoadMore(
                            movieQuery.fetchNextPage,
                            movieQuery.hasNextPage,
                            movieQuery.isFetchingNextPage,
                            movieQuery.isFetchNextPageError
                        )}
                    </>
                )}
            </TabsContent>

            {/* TV Tab */}
            <TabsContent value="tv" className="mt-4">
                {tvQuery.error && !tvQuery.isFetchNextPageError ? (
                    <ErrorState
                        message="Failed to load TV search results."
                        onRetry={() => void tvQuery.refetch()}
                    />
                ) : tvShows.length === 0 ? (
                    <EmptyState
                        title="No TV shows found"
                        message={`No TV shows matched "${trimmedQuery}".`}
                    />
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                            {/* eslint-disable-next-line */}
                            {tvShows.map((tv: any) => (
                                <MediaCard
                                    key={tv.id}
                                    id={tv.id}
                                    title={tv.name}
                                    posterPath={tv.poster_path}
                                    rating={tv.vote_average || 0}
                                    releaseDate={tv.first_air_date}
                                    mediaType="tv"
                                    genre_ids={tv.genre_ids}
                                    layout="horizontal"
                                />
                            ))}
                        </div>
                        {renderLoadMore(
                            tvQuery.fetchNextPage,
                            tvQuery.hasNextPage,
                            tvQuery.isFetchingNextPage,
                            tvQuery.isFetchNextPageError
                        )}
                    </>
                )}
            </TabsContent>

            {/* People Tab */}
            <TabsContent value="person" className="mt-4">
                {peopleQuery.error && !peopleQuery.isFetchNextPageError ? (
                    <ErrorState
                        message="Failed to load people search results."
                        onRetry={() => void peopleQuery.refetch()}
                    />
                ) : people.length === 0 ? (
                    <EmptyState
                        title="No people found"
                        message={`No people matched "${trimmedQuery}".`}
                    />
                ) : (
                    <>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                            {/* eslint-disable-next-line */}
                            {people.map((person: any) => (
                                <CastCard
                                    key={person.id}
                                    data={person}
                                    mediaType="movie"
                                />
                            ))}
                        </div>
                        {renderLoadMore(
                            peopleQuery.fetchNextPage,
                            peopleQuery.hasNextPage,
                            peopleQuery.isFetchingNextPage,
                            peopleQuery.isFetchNextPageError
                        )}
                    </>
                )}
            </TabsContent>

            {/* Keywords Tab */}
            <TabsContent value="keyword" className="mt-4">
                {keywordQuery.error && !keywordQuery.isFetchNextPageError ? (
                    <ErrorState
                        message="Failed to load keyword search results."
                        onRetry={() => void keywordQuery.refetch()}
                    />
                ) : keywords.length === 0 ? (
                    <EmptyState
                        title="No keywords found"
                        message={`No keywords matched "${trimmedQuery}".`}
                    />
                ) : (
                    <>
                        <div className="flex flex-wrap gap-2">
                            {/* eslint-disable-next-line */}
                            {keywords.map((keyword: any) => (
                                <Link key={keyword.id} href={`/keyword/${keyword.id}-${slugify(keyword.name || "")}`} className={buttonVariants({ variant: "secondary" })}>
                                    {keyword.name || "Untitled"}
                                </Link>
                            ))}
                        </div>
                        {renderLoadMore(
                            keywordQuery.fetchNextPage,
                            keywordQuery.hasNextPage,
                            keywordQuery.isFetchingNextPage,
                            keywordQuery.isFetchNextPageError
                        )}
                    </>
                )}
            </TabsContent>
        </Tabs>
    );
};

export default SearchWrapper;