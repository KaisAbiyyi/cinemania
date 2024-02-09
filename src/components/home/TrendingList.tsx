import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { format } from "date-fns";
import { FC, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { Button } from "../ui/button";

const TrendingList: FC = () => {
    const token = import.meta.env.VITE_TMDB_API_RAT
    const [timeWindow, setTimeWindow] = useState<string>("day")

    const { data: Trending, isPending: TrendingPending, refetch } = useQuery({
        queryKey: ["getTrendingHomepage"],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/trending/all/${timeWindow}`, { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    console.log(Trending)

    if (TrendingPending) {
        return (
            <div className="flex gap-4">
                <Skeleton className="h-72 w-56" />
                <Skeleton className="h-72 w-56" />
                <Skeleton className="h-72 w-56" />
            </div>
        )
    }
    return (
        <div className="flex flex-col rounded-lg gap-8">
            <div className="flex gap-8 items-center">
                <CardTitle>Trending</CardTitle>
                <div className="flex rounded-lg overflow-hidden">
                    <Button
                        variant={timeWindow === "day" ? "default" : "secondary"}
                        className="rounded-none"
                        onClick={() => {
                            setTimeWindow("day")
                            setTimeout(() => {
                                refetch()
                            }, 100);
                        }}
                        size="sm"
                        type="button">Today</Button>
                    <Button
                        variant={timeWindow === "week" ? "default" : "secondary"}
                        onClick={() => {
                            setTimeWindow("week")
                            setTimeout(() => {
                                refetch()
                            }, 100);
                        }}
                        className="rounded-none"
                        size="sm"
                        type="button">This Week</Button>
                </div>
            </div>
            <div className="flex gap-8 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full  scrollbar-w-3 scrollbar-track-transparent">
                {Trending.results.map((item: any) => (
                    <Card key={item.id} className="flex gap-4 relative border-none bg-transparent flex-col">
                        <div className="bg-orange-500 text-primary-foreground text-xs font-bold p-2 rounded-full absolute top-2 right-2">{(item.vote_average as number).toFixed(1)}</div>
                        <CardHeader className="p-0 w-56">
                            <Link to={`${item.media_type}/${item.id}-${((item.name || item.original_title) as string).toLowerCase().replace(/ /g, "-")}`}>
                                <img src={`${import.meta.env.VITE_TMDB_POSTER_URL}/w500${item.poster_path}`} className="rounded-lg" alt={item.name} />
                            </Link>
                        </CardHeader>
                        <CardContent>
                            <CardTitle className="text-lg">{item.name ?? item.original_title}</CardTitle>
                            <CardDescription>{format(new Date(item.release_date || item.first_air_date), "MMM dd, yyyy")}</CardDescription>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}

export default TrendingList;