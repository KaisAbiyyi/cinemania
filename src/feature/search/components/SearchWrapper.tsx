"use client";

import ErrorState from "@/components/ErrorState";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MediaCard from "@/feature/media/components/MediaCard";
import CastCard from "@/feature/media/components/cast/CastCard";
import { slugify } from "@/lib/utils";
import Link from "next/link";
import { FC } from "react";
import { useSearch } from "../hooks/useSearch";
import SearchWrapperSkeleton from "./skeletons/SearchWrapperSkeleton";

interface Props {
    query: string;
}

const SearchWrapper: FC<Props> = ({ query }) => {
    const movieQuery = useSearch(query, "movie");
    const tvQuery = useSearch(query, "tv");
    const peopleQuery = useSearch(query, "person");
    const keywordQuery = useSearch(query, "keyword");

    const renderLoadMore = (fetchNextPage: () => void, hasNextPage: boolean | undefined, isFetchingNextPage: boolean) => (
        hasNextPage && (
            <div className="flex justify-center mt-4">
                <Button
                    variant="secondary"
                    className="w-full"
                    onClick={fetchNextPage}
                    disabled={isFetchingNextPage}
                >
                    {isFetchingNextPage ? "Loading..." : "Load More"}
                </Button>
            </div>
        )
    );

    if (movieQuery.isLoading || tvQuery.isLoading || peopleQuery.isLoading || keywordQuery.isLoading) {
        return <SearchWrapperSkeleton />
    }

    if (movieQuery.error || tvQuery.error || peopleQuery.error || keywordQuery.error || !movieQuery.data || !tvQuery.data || !peopleQuery.data || !keywordQuery.data) {
        return <ErrorState message="Failed to load search results. Please try again later." onRetry={() => window.location.reload()} />;
    }

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
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                    {movieQuery.data?.pages.map((page) =>
                        // eslint-disable-next-line
                        page.results.map((movie: any) => (
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
                        ))
                    )}
                </div>
                {renderLoadMore(movieQuery.fetchNextPage, movieQuery.hasNextPage, movieQuery.isFetchingNextPage)}
            </TabsContent>

            {/* TV Tab */}
            <TabsContent value="tv" className="mt-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                    {tvQuery.data?.pages.map((page) =>
                        // eslint-disable-next-line
                        page.results.map((tv: any) => (
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
                        ))
                    )}
                </div>
                {renderLoadMore(tvQuery.fetchNextPage, tvQuery.hasNextPage, tvQuery.isFetchingNextPage)}
            </TabsContent>

            {/* People Tab */}
            <TabsContent value="person" className="mt-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    {peopleQuery.data?.pages.map((page) =>
                        // eslint-disable-next-line
                        page.results.map((person: any) => (
                            <CastCard
                                key={person.id}
                                data={person}
                                mediaType="movie"
                            />
                        ))
                    )}
                </div>
                {renderLoadMore(peopleQuery.fetchNextPage, peopleQuery.hasNextPage, peopleQuery.isFetchingNextPage)}
            </TabsContent>

            {/* Keywords Tab */}
            <TabsContent value="keyword" className="mt-4">
                <div className="flex flex-wrap gap-2">
                    {keywordQuery.data?.pages.map((page) =>
                        // eslint-disable-next-line
                        page.results.map((keyword: any) => (
                            <Link key={keyword.id} href={`/keyword/${keyword.id}-${slugify(keyword.name)}`} className={buttonVariants({ variant: "secondary" })}>
                                {keyword.name}
                            </Link>
                        ))
                    )}
                </div>
                {renderLoadMore(keywordQuery.fetchNextPage, keywordQuery.hasNextPage, keywordQuery.isFetchingNextPage)}
            </TabsContent>
        </Tabs>
    );
};

export default SearchWrapper;