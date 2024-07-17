import { buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import Filter from "@/components/ui/Filter";
import MovieCard from "@/components/ui/MovieCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { ChevronRight } from "lucide-react";
import { FC, useCallback, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { Link } from "react-router-dom";

const TVTopRated: FC = () => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const [sortBy, setSortBy] = useState<string>("vote_average.desc");
    const [FromReleaseDate, setFromReleaseDate] = useState<Date>();
    const [ToReleaseDate, setToReleaseDate] = useState<Date>();
    const [selectedGenres, setSelectedGenres] = useState<Array<string>>([]);
    const [userScore, setUserScore] = useState<Array<number>>([0, 10]);
    const [minimumUserVotes, setMinimumUserVotes] = useState<Array<number>>([200]);
    const [runtime, setRuntime] = useState<Array<number>>([0, 360]);

    const fetchTrending = async ({ pageParam = 1 }) => {
        const params: Record<string, any> = {
            page: pageParam,
            include_video: false,
            include_adult: false,
            sort_by: sortBy,
            "air_date.gte": FromReleaseDate?.toISOString(),
            "air_date.lte": ToReleaseDate?.toISOString(),
            "vote_average.gte": userScore[0],
            "vote_average.lte": userScore[1],
            "vote_count.gte": minimumUserVotes[0],
            with_genres: selectedGenres.join(","),
            "with_runtime.gte": runtime[0],
            "with_runtime.lte": runtime[1]
        };
        const { data } = await axios.get(
            "https://api.themoviedb.org/3/discover/tv?language=en-US",
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
        error: TrendingError,
    } = useInfiniteQuery({
        queryKey: ['getTVTopRated', sortBy, FromReleaseDate, ToReleaseDate, userScore, minimumUserVotes, selectedGenres, runtime],
        queryFn: fetchTrending,
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const nextPage = allPages.length + 1;
            return lastPage.page < lastPage.total_pages ? nextPage : undefined;
        }, // Disable automatic refetching
    });
    const { data: TVGenre, isLoading: TVGenrePending, error: TVGenreError } = useQuery({
        queryKey: ['getTVGenre'],
        queryFn: async () => {
            const { data } = await axios.get("https://api.themoviedb.org/3/genre/tv/list", { headers: { Authorization: `Bearer ${token}` } });
            return data;
        }
    });

    const observerElem = useRef<HTMLDivElement | null>(null);
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
                <title>Top Rated TV Shows | Cinemania</title>
            </Helmet>
            <div className="flex flex-col gap-8 px-8 pb-8">
                <CardTitle>Top Rated TV Shows</CardTitle>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-2">
                        <Link to="/tv/airing-today" className={buttonVariants({ variant: "outline", className: "!justify-between" })}>
                            <span className="mr-3">Airing Today</span>
                            <ChevronRight size={18} />
                        </Link>
                        <Link to="/tv/on-the-air" className={buttonVariants({ variant: "outline", className: "!justify-between" })}>
                            <span className="mr-3">On TV</span>
                            <ChevronRight size={18} />
                        </Link>
                        <Link to="/tv/top-rated" className={buttonVariants({ variant: "default", className: "!justify-between" })}>
                            <span className="mr-3">Top Rated</span>
                        </Link>
                    </div>
                    <Filter
                        sortBy={sortBy}
                        setSortBy={setSortBy}
                        FromReleaseDate={FromReleaseDate}
                        setFromReleaseDate={setFromReleaseDate}
                        ToReleaseDate={ToReleaseDate}
                        setToReleaseDate={setToReleaseDate}
                        selectedGenres={selectedGenres}
                        setSelectedGenres={setSelectedGenres}
                        Genre={TVGenre}
                        GenrePending={TVGenrePending}
                        userScore={userScore}
                        setUserScore={setUserScore}
                        minimumUserVotes={minimumUserVotes}
                        setMinimumUserVotes={setMinimumUserVotes}
                        runtime={runtime}
                        setRuntime={setRuntime}
                    />
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
                    {(TrendingPending || TVGenrePending) ? <TVTopRatedSkeleton /> :
                        Trending?.pages.map((page) =>
                            page.results.map((item: any, index: number) => {
                                if (page.results.length === index + 1) {
                                    return (
                                        <div ref={lastTrendingElementRef} key={item.id}>
                                            <MovieCard
                                                TVGenre={TVGenre.genres}
                                                isGrid
                                                mediaType={"tv"}
                                                item={item}
                                                key={item.id}
                                            />
                                        </div>
                                    );
                                } else {
                                    return (
                                        <MovieCard
                                            TVGenre={TVGenre.genres}
                                            isGrid
                                            mediaType={"tv"}
                                            item={item}
                                            key={item.id}
                                        />
                                    );
                                }
                            })
                        )}
                    {isFetchingNextPage && <TVTopRatedSkeleton />}
                </div>
                <div ref={observerElem} />
                {TrendingError && <div>Error loading trending movies. Please try again later.</div>}
                {TVGenreError && <div>Error loading movie genres. Please try again later.</div>}
            </div>
        </>
    );
}

const TVTopRatedSkeleton = () => {
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

export default TVTopRated;
