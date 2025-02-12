import MovieCardSecondary from "@/components/MovieCardSecondary";
import { buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { useTopRatedMovie } from "@/hooks/useTopRatedMovie";
import { Movie } from "@/types/movie";
import { formatDate } from "@/utils/dateUtils";
import { ChevronRight } from "lucide-react";
import { FC } from "react";
import { Link } from "react-router-dom";

const TopRatedMovieList: FC = () => {
    const { data, isPending } = useTopRatedMovie()

    if (isPending) return "loading"

    const movies = data.results.slice(0, 3)

    return (
        <div className="flex flex-col gap-6">
            <div className="flex justify-between">
                <CardTitle>Top Rated Movie</CardTitle>
                <Link to={'/movie'} className={buttonVariants({ variant: "ghost", className: "w-fit" })}>
                    More
                    <ChevronRight />
                </Link>
            </div>
            <div className="flex flex-col gap-4">
                {movies.map((movie: Movie) => (
                    <MovieCardSecondary
                        id={movie.id}
                        title={movie.title || movie.original_title}
                        releaseDate={formatDate(movie.release_date)}
                        posterPath={movie.poster_path}
                        rating={movie.vote_average}
                        description={movie.overview}
                        type="movie"
                        genre_ids={movie.genre_ids}
                        key={movie.id} />
                ))}
            </div>
        </div>
    );
}

export default TopRatedMovieList;