import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { FC, useState } from "react";
import MovieCard from "../ui/MovieCard";
import { Button } from "../ui/button";
import { CardTitle } from "../ui/card";
import TrendingListSkeleton from "./Skeletons/TrendingListSkeleton";

interface TrendingListProps {
    MovieGenre: any
    TVGenre: any
}

const TrendingList: FC<TrendingListProps> = ({ MovieGenre, TVGenre }) => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const [timeWindow, setTimeWindow] = useState<string>("day");

    const { data: Trending, isPending: TrendingPending, refetch } = useQuery({
        queryKey: ["getTrendingHomepage", timeWindow],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/trending/all/${timeWindow}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return data;
        }
    });

    if (TrendingPending) {
        return (
            <TrendingListSkeleton />
        );
    }

    return (
        <div className="flex flex-col gap-8 p-4 rounded-lg">
            <div className="flex items-center gap-8">
                <CardTitle>Trending</CardTitle>
                <div className="flex overflow-hidden rounded-full bg-secondary">
                    {["day", "week"].map((window) => (
                        <Button
                            key={window}
                            variant={timeWindow === window ? "default" : "ghost"}
                            className="rounded-full"
                            onClick={() => {
                                setTimeWindow(window);
                                setTimeout(() => {
                                    refetch();
                                }, 100);
                            }}
                            size="sm"
                            type="button"
                        >
                            {window === "day" ? "Today" : "This Week"}
                        </Button>
                    ))}
                </div>
            </div>
            <div className="flex gap-4 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                {Trending?.results.map((item: any) => (
                    <MovieCard key={item.id} item={item} mediaType={item.media_type} MovieGenre={MovieGenre} TVGenre={TVGenre} />
                ))}
            </div>
        </div>
    );
};

export default TrendingList;
