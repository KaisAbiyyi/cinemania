import { CardTitle } from "@/components/ui/card";
import MovieCard from "@/components/ui/MovieCard";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { FC, useCallback, useRef, useState } from "react";

const MoviePage: FC = () => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const [sortBy, setSortBy] = useState<string>("popularity.desc");

    const fetchTrending = async ({ pageParam = 1 }) => {
        const params: Record<string, any> = {
            page: pageParam,
            include_video: false,
            include_adult: false,
            sort_by: sortBy,
        };

        if (sortBy === "primary_release_date.desc") {
            params['release_date.lte'] = new Date().toISOString();
        }

        const { data } = await axios.get(
            "https://api.themoviedb.org/3/discover/movie?language=en-US",
            {
                headers: { Authorization: `Bearer ${token}` },
                params,
            }
        );
        return data;
    };

    const {
        data: Trending,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: TrendingPending,
    } = useInfiniteQuery({
        queryKey: ['getTrending', sortBy],
        queryFn: fetchTrending,
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const nextPage = allPages.length + 1;
            return lastPage.page < lastPage.total_pages ? nextPage : undefined;
        }
    })

    const { data: MovieGenre, isLoading: MovieGenrePending } = useQuery({
        queryKey: ['getMovieGenre'],
        queryFn: async () => {
            const { data } = await axios.get("https://api.themoviedb.org/3/genre/movie/list", { headers: { Authorization: `Bearer ${token}` } });
            return data;
        }
    });

    const observerElem = useRef<HTMLDivElement | null>(null);

    const sortByHandler = (e: string) => {
        setSortBy(e);
    };
    const observer = useRef<IntersectionObserver>();
    const lastTrendingElementRef = useCallback((node: HTMLDivElement) => {
        if (TrendingPending || isFetchingNextPage) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasNextPage) {
                fetchNextPage();
            }
        });
        if (node) observer.current.observe(node);
    }, [TrendingPending, isFetchingNextPage, hasNextPage, fetchNextPage]);

    return (
        <div className="flex flex-col gap-8 px-8 pb-8">
            <CardTitle>Movies</CardTitle>
            <div className="flex gap-4">
                <Select onValueChange={sortByHandler}>
                    <SelectTrigger className="w-[180px]" title="Filter">
                        <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="popularity.desc">Popularity DESC</SelectItem>
                        <SelectItem value="popularity.asc">Popularity ASC</SelectItem>
                        <SelectItem value="vote_average.desc">Rating DESC</SelectItem>
                        <SelectItem value="vote_average.asc">Rating ASC</SelectItem>
                        <SelectItem value="primary_release_date.desc">Release Date DESC</SelectItem>
                        <SelectItem value="primary_release_date.asc">Release Date ASC</SelectItem>
                        <SelectItem value="title.asc">Title (A-Z)</SelectItem>
                        <SelectItem value="title.desc">Title (Z-A)</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="grid grid-cols-5 gap-4">
                {(TrendingPending || MovieGenrePending) ? <MoviePageSkeleton /> :
                    Trending?.pages.map((page) =>
                        page.results.map((item: any, index: number) => {
                            if (page.results.length === index + 1) {
                                return (
                                    <div ref={lastTrendingElementRef} key={item.id}>
                                        <MovieCard
                                            MovieGenre={MovieGenre.genres}
                                            isGrid
                                            mediaType={"movie"}
                                            item={item}
                                            key={item.id}
                                        />
                                    </div>
                                );
                            } else {
                                return (
                                    <MovieCard
                                        MovieGenre={MovieGenre.genres}
                                        isGrid
                                        mediaType={"movie"}
                                        item={item}
                                        key={item.id}
                                    />
                                );
                            }
                        })
                    )}
                {isFetchingNextPage && <MoviePageSkeleton />}
            </div>
            <div ref={observerElem} />
        </div>
    );
}

const MoviePageSkeleton = () => {
    return (
        <>
            <Skeleton className="w-full h-96" />
            <Skeleton className="w-full h-96" />
            <Skeleton className="w-full h-96" />
            <Skeleton className="w-full h-96" />
            <Skeleton className="w-full h-96" />
        </>
    )
}

export default MoviePage;
