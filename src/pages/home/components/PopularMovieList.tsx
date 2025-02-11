import MovieCard from "@/components/MovieCard";
import { buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { usePopular } from "@/hooks/usePopular";
import { Movie } from "@/types/movie";
import { ChevronRight } from "lucide-react";
import { FC } from "react";
import { Link } from "react-router-dom";


const PopularMovieList: FC = () => {
    const { data, isPending } = usePopular('movie')

    if (isPending) return "loading"

    const movies = data.results.slice(0, 10)
    return (
        <div className="flex flex-col gap-6">
            <div className="flex justify-between">
                <CardTitle>Popular Movies</CardTitle>
                <Link to={'/movie'} className={buttonVariants({ variant: "ghost", className: "w-fit" })}>
                    More
                    <ChevronRight />
                </Link>
            </div>
            <div className="flex gap-4 pb-5 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                {movies.map((movie: Movie) => (
                    <MovieCard
                        key={movie.id}
                        id={movie.id}
                        title={movie.title || movie.original_title}
                        posterPath={movie.poster_path}
                        rating={movie.vote_average}
                        releaseDate={movie.release_date}
                        type="movie"
                    />
                ))}
            </div>
        </div>
    );
}

export default PopularMovieList;