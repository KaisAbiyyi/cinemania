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

const MoviePage: FC = () => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const [sortBy, setSortBy] = useState<string>("popularity.desc");
    const [FromReleaseDate, setFromReleaseDate] = useState<Date>();
    const [ToReleaseDate, setToReleaseDate] = useState<Date>();
    const [selectedGenres, setSelectedGenres] = useState<Array<string>>([]);
    const [userScore, setUserScore] = useState<Array<number>>([0, 10]);
    const [minimumUserVotes, setMinimumUserVotes] = useState<Array<number>>([0]);
    const [runtime, setRuntime] = useState<Array<number>>([0, 360]);

    const fetchTrending = async ({ pageParam = 1 }) => {
        const params: Record<string, any> = {
            page: pageParam,
            include_video: false,
            include_adult: false,
            sort_by: sortBy,
            "release_date.gte": FromReleaseDate?.toISOString(),
            "release_date.lte": ToReleaseDate?.toISOString(),
            "vote_average.gte": userScore[0],
            "vote_average.lte": userScore[1],
            "vote_count.gte": minimumUserVotes[0],
            with_genres: selectedGenres.join(","),
            "with_runtime.gte": runtime[0],
            "with_runtime.lte": runtime[1]
        };

        if (sortBy === "primary_release_date.desc") {
            params['release_date.lte'] = new Date().toISOString();
        }

        const { data } = await axios.get(
            "https://api.themoviedb.org/3/discover/movie",
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
        queryKey: ['getMovies', sortBy, FromReleaseDate, ToReleaseDate, selectedGenres, userScore, minimumUserVotes, runtime],
        queryFn: fetchTrending,
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const nextPage = allPages.length + 1;
            return lastPage.page < lastPage.total_pages ? nextPage : undefined;
        }, // Disable automatic refetching
    });
    const { data: MovieGenre, isLoading: MovieGenrePending, error: MovieGenreError } = useQuery({
        queryKey: ['getMovieGenre'],
        queryFn: async () => {
            const { data } = await axios.get("https://api.themoviedb.org/3/genre/movie/list", { headers: { Authorization: `Bearer ${token}` } });
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
                <title>Movies | Cinemania</title>
            </Helmet>
            <div className="flex flex-col gap-8 px-8 pb-8">
                <CardTitle>Movies</CardTitle>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-2">
                        <Link to="/movie/now-playing" className={buttonVariants({ variant: "outline", className: "!justify-between" })}>
                            <span className="mr-3">Now Playing</span>
                            <ChevronRight size={18} />
                        </Link>
                        <Link to="/movie/now-playing" className={buttonVariants({ variant: "outline", className: "!justify-between" })}>
                            <span className="mr-3">Upcoming</span>
                            <ChevronRight size={18} />
                        </Link>
                        <Link to="/movie/now-playing" className={buttonVariants({ variant: "outline", className: "!justify-between" })}>
                            <span className="mr-3">Top Rated</span>
                            <ChevronRight size={18} />
                        </Link>
                    </div>
                    <Filter
                        isMovie
                        sortBy={sortBy}
                        setSortBy={setSortBy}
                        FromReleaseDate={FromReleaseDate}
                        setFromReleaseDate={setFromReleaseDate}
                        ToReleaseDate={ToReleaseDate}
                        setToReleaseDate={setToReleaseDate}
                        selectedGenres={selectedGenres}
                        setSelectedGenres={setSelectedGenres}
                        Genre={MovieGenre}
                        GenrePending={MovieGenrePending}
                        userScore={userScore}
                        setUserScore={setUserScore}
                        minimumUserVotes={minimumUserVotes}
                        setMinimumUserVotes={setMinimumUserVotes}
                        runtime={runtime}
                        setRuntime={setRuntime}
                    />
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
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
                {TrendingError && <div>Error loading trending movies. Please try again later.</div>}
                {MovieGenreError && <div>Error loading movie genres. Please try again later.</div>}
            </div>
        </>
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
