import MovieCard from "@/components/MovieCard";
import { buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import {
    Carousel,
    CarouselContent,
    CarouselItem,
    CarouselNext,
    CarouselPrevious,
} from "@/components/ui/carousel";
import { useNowPlayingMovie } from "@/hooks/useNowPlayingMovie";
import { Movie } from "@/types/movie";
import Autoplay from "embla-carousel-autoplay";
import { ChevronRight } from "lucide-react";
import { FC } from "react";
import { Link } from "react-router-dom";



const NowPlayingMovie: FC = () => {
    const { data, isPending } = useNowPlayingMovie()

    if (isPending) return "loading"

    const movies = data.results.slice(0, 6)

    return (
        <div className="flex flex-col w-full gap-6 lg:w-1/2">
            <div className="flex justify-between">
                <CardTitle>Now Playing</CardTitle>
                <Link to={'/movie'} className={buttonVariants({ variant: "ghost", className: "w-fit" })}>
                    More
                    <ChevronRight />
                </Link>
            </div>
            <Carousel className="flex items-center gap-4" opts={{ loop: true }} plugins={[Autoplay({ delay: 10000, stopOnInteraction: true })]}>
                <CarouselPrevious className="relative top-auto left-auto translate-y-0" />
                <CarouselContent>
                    {movies.map((movie: Movie) => (
                        <CarouselItem className="sm:basis-1/2 lg:basis-full xl:basis-1/2">
                            <MovieCard
                                key={movie.id}
                                id={movie.id}
                                title={movie.title || movie.original_title}
                                releaseDate={movie.release_date}
                                rating={movie.vote_average}
                                posterPath={movie.poster_path}
                                type="movie" />
                        </CarouselItem>
                    ))}
                </CarouselContent>
                <CarouselNext className="relative top-auto right-auto translate-y-0" />
            </Carousel>

        </div>
    );
}

export default NowPlayingMovie;