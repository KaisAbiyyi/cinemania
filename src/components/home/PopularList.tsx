import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { FC } from "react";
import MovieCard from "../ui/MovieCard";
import { CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

interface PopularListProps {
    MovieGenre: any
    TVGenre: any
}

const PopularList: FC<PopularListProps> = ({ MovieGenre, TVGenre }) => {
    const token = import.meta.env.VITE_TMDB_API_RAT

    const { data: Popular, isPending: PopularPending } = useQuery({
        queryKey: ["getPopularHomepage"],
        queryFn: async () => {
            const { data } = await axios.get("https://api.themoviedb.org/3/movie/popular?page=1", { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    // console.log(Popular)

    if (PopularPending) {
        return (
            <div className="flex flex-col gap-8 p-4">
                <div className="flex items-center gap-8">
                    <CardTitle>Popular Movies</CardTitle>

                </div>
                <div className="flex gap-4 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                    <Skeleton className="w-64 h-96" />
                    <Skeleton className="w-64 h-96" />
                    <Skeleton className="w-64 h-96" />
                    <Skeleton className="w-64 h-96" />
                    <Skeleton className="w-64 h-96" />
                </div>
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-8 p-4 rounded-lg">
            <CardTitle>Popular Movies</CardTitle>
            <div className="flex items-start gap-4 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                {Popular.results.map((item: any) => (
                    <MovieCard item={item} key={item.id} mediaType="movie" MovieGenre={MovieGenre} TVGenre={TVGenre} />
                ))}
            </div>
        </div>
    )
}

export default PopularList;