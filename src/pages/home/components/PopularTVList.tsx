import MovieCard from "@/components/MovieCard";
import { buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { usePopular } from "@/hooks/usePopular";
import { TVShow } from "@/types/tv";
import { ChevronRight } from "lucide-react";
import { FC } from "react";
import { Link } from "react-router-dom";


const PopularTVList: FC = () => {
    const { data, isPending } = usePopular("tv")

    if (isPending) return "loading"

    const tvs = data.results.slice(0, 10)
    return (
        <div className="flex flex-col gap-6">
            <div className="flex justify-between">
                <CardTitle>Popular TV Series</CardTitle>
                <Link to={'/tv'} className={buttonVariants({ variant: "ghost", className: "w-fit" })}>
                    More
                    <ChevronRight />
                </Link>
            </div>
            <div className="flex gap-4 pb-5 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                {tvs.map((tv: TVShow) => (
                    <MovieCard
                        key={tv.id}
                        id={tv.id}
                        title={tv.name || tv.original_name}
                        posterPath={tv.poster_path}
                        rating={tv.vote_average}
                        releaseDate={tv.first_air_date}
                        type="tv"
                    />
                ))}
            </div>
        </div>
    );
}

export default PopularTVList;