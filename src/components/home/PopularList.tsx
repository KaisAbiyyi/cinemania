import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { format } from "date-fns";
import { FC } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

const PopularList: FC = () => {
    const token = import.meta.env.VITE_TMDB_API_RAT

    const { data: Popular, isPending: PopularPending } = useQuery({
        queryKey: ["getPopularHomepage"],
        queryFn: async () => {
            const { data } = await axios.get("https://api.themoviedb.org/3/movie/popular?page=1", { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    console.log(Popular)

    if (PopularPending) {
        return (
            <div className="flex gap-4 p-4">
                <Skeleton className="w-56 h-72" />
                <Skeleton className="w-56 h-72" />
                <Skeleton className="w-56 h-72" />
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-8 p-4 rounded-lg">
            <CardTitle>Popular Movies</CardTitle>
            <div className="flex items-start gap-8 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                {Popular.results.map((item: any) => (
                    <Card key={item.id} className="relative flex flex-col gap-4 bg-transparent border-none">
                        <div className="absolute p-2 text-xs font-bold bg-orange-500 rounded-full text-primary-foreground top-2 right-2">{(item.vote_average as number).toFixed(1)}</div>
                        <CardHeader className="w-56 p-0">
                            <Link to={`movie/${item.id}-${((item.name || item.original_title) as string).toLowerCase().replace(/ /g, "-")}`}>
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

export default PopularList;