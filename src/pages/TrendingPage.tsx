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
import { Helmet } from "react-helmet";

const TrendingPage: FC = () => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const [type, setType] = useState<string>("all");
    const [timeWindow, setTimeWindow] = useState<string>("day");

    const fetchTrending = async ({ pageParam = 1 }) => {
        const { data } = await axios.get(`https://api.themoviedb.org/3/trending/${type}/${timeWindow}`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { page: pageParam }
        });
        return data;
    };

    const {
        data: Trending,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: TrendingPending,
    } = useInfiniteQuery({
        queryKey: ['getTrending', timeWindow, type],
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

    const { data: TVGenre, isLoading: TVGenrePending } = useQuery({
        queryKey: ['getTVGenre'],
        queryFn: async () => {
            const { data } = await axios.get("https://api.themoviedb.org/3/genre/tv/list", { headers: { Authorization: `Bearer ${token}` } });
            return data;
        }
    });

    const observerElem = useRef<HTMLDivElement | null>(null);

    const typeHandler = (e: string) => {
        setType(e);
    };

    const timeWindowHandler = (e: string) => {
        setTimeWindow(e);
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
        <>
        <Helmet>
            <title>Trending | Cinemania</title>
        </Helmet>
            <div className="flex flex-col gap-8 px-8 pb-8">
                <CardTitle>{timeWindow === "day" ? "Daily " : "Weekly "}Trending</CardTitle>
                <div className="flex gap-4">
                    <Select onValueChange={typeHandler}>
                        <SelectTrigger className="w-[180px]" title="Filter">
                            <SelectValue placeholder={type.charAt(0).toUpperCase() + type.slice(1)} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="movie">Movies</SelectItem>
                            <SelectItem value="tv">TV</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select onValueChange={timeWindowHandler}>
                        <SelectTrigger className="w-[180px]" title="Time Range">
                            <SelectValue placeholder={timeWindow.charAt(0).toUpperCase() + timeWindow.slice(1)} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="day">Day</SelectItem>
                            <SelectItem value="week">Week</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="grid grid-cols-5 gap-4">
                    {(TrendingPending || MovieGenrePending || TVGenrePending) ? <TrendingPageSkeleton /> :
                        Trending?.pages.map((page) =>
                            page.results.map((item: any, index: number) => {
                                if (page.results.length === index + 1) {
                                    return (
                                        <div ref={lastTrendingElementRef} key={item.id}>
                                            <MovieCard
                                                MovieGenre={MovieGenre.genres}
                                                isGrid
                                                mediaType={item.media_type}
                                                TVGenre={TVGenre.genres}
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
                                            mediaType={item.media_type}
                                            TVGenre={TVGenre.genres}
                                            item={item}
                                            key={item.id}
                                        />
                                    );
                                }
                            })
                        )}
                    {isFetchingNextPage && <TrendingPageSkeleton />}
                </div>
                <div ref={observerElem} />
            </div>
        </>
    );
}

const TrendingPageSkeleton = () => {
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

export default TrendingPage;
