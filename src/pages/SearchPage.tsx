import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import MovieCardHorizontal from "@/components/ui/MovieCardHorizontal";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { FC, useCallback, useMemo, useRef } from "react";
import { Helmet } from "react-helmet";
import { useSearchParams } from "react-router-dom";

const SearchPage: FC = () => {
    const [searchParams] = useSearchParams();
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const query = searchParams.get("q");

    const fetchSearch = async ({ pageParam = 1 }) => {
        const params: Record<string, any> = {
            page: pageParam,
            include_adult: false,
            query
        };
        const { data } = await axios.get(
            "https://api.themoviedb.org/3/search/multi",
            {
                headers: { Authorization: `Bearer ${token}` },
                params,
            }
        );
        return data;
    };

    const {
        data: Search,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: SearchPending,
        error: SearchError,
    } = useInfiniteQuery({
        queryKey: ['getMovies', query],
        queryFn: fetchSearch,
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const nextPage = allPages.length + 1;
            return lastPage.page < lastPage.total_pages ? nextPage : undefined;
        },
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
    const lastSearchElementRef = useCallback((node: HTMLDivElement) => {
        if (SearchPending || isFetchingNextPage) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasNextPage) {
                fetchNextPage();
            }
        });
        if (node) observer.current.observe(node);
    }, [SearchPending, isFetchingNextPage, hasNextPage, fetchNextPage]);

    // Count items with media_type = "person"
    const movieCount = useMemo(() => {
        return Search?.pages?.reduce((acc, page) => {
            return acc + page.results.filter((item: any) => item.media_type === "movie").length;
        }, 0) || 0;
    }, [Search]);
    const tvCount = useMemo(() => {
        return Search?.pages?.reduce((acc, page) => {
            return acc + page.results.filter((item: any) => item.media_type === "tv").length;
        }, 0) || 0;
    }, [Search]);
    const personCount = useMemo(() => {
        return Search?.pages?.reduce((acc, page) => {
            return acc + page.results.filter((item: any) => item.media_type === "person").length;
        }, 0) || 0;
    }, [Search]);

    return (
        <>
            <Helmet>
                <title>{query} | Cinemania</title>
            </Helmet>
            <div className="flex flex-col gap-8 px-8 pb-8">
                {(SearchPending || MovieGenrePending) ? "Loading" :
                    <>
                        <CardTitle>Search Results for : {query}</CardTitle>
                        <div className="flex flex-wrap gap-2">
                            <Button className="justify-between" variant="outline" size="sm">
                                <span>Movies</span>
                                {movieCount > 0 &&
                                    <span className="ml-2">({movieCount})</span>
                                }
                            </Button>
                            <Button className="justify-between" variant="outline" size="sm">
                                <span>TV Shows</span>
                                {tvCount > 0 &&
                                    <span className="ml-2">({tvCount})</span>
                                }
                            </Button>
                            <Button className="justify-between" variant="outline" size="sm">
                                <span>People</span>
                                {personCount > 0 && (
                                    <span className="ml-2">({personCount})</span>
                                )}
                            </Button>
                        </div>
                        <div className="flex flex-col gap-4">
                            {Search?.pages?.map((page) =>
                                page?.results.map((item: any, index: number) => {
                                    if (page.results.length === index + 1) {
                                        return (
                                            <div ref={lastSearchElementRef} key={item.id}>
                                                <MovieCardHorizontal
                                                    MovieGenre={MovieGenre.genres}
                                                    mediaType={"movie"}
                                                    item={item}
                                                    key={item.id}
                                                />
                                            </div>
                                        );
                                    } else {
                                        return (
                                            <MovieCardHorizontal
                                                MovieGenre={MovieGenre.genres}
                                                mediaType={"movie"}
                                                item={item}
                                                key={item.id}
                                            />
                                        );
                                    }
                                })
                            )}
                        </div>
                        <div ref={observerElem} />
                        {SearchError && <div>Error loading trending movies. Please try again later.</div>}
                        {MovieGenreError && <div>Error loading movie genres. Please try again later.</div>}
                    </>
                }
            </div >
        </>
    );
};

export default SearchPage;
