import { buttonVariants } from "@/components/ui/button";
import {
    Carousel,
    CarouselContent,
    CarouselItem,
    CarouselNext,
    CarouselPrevious,
} from "@/components/ui/carousel";
import { Genre } from "@/types/genre";
import { FC } from "react";
import { Link } from "react-router-dom";
import { useGenres } from "../../hooks/useGenres";
import GenreListSkeleton from "./GenreListSkeleton";

const TVGenreList: FC = () => {
    const { data: genres, isPending } = useGenres('tv')
    if (isPending) return (
        <GenreListSkeleton />
    )
    return (
        <Carousel className="flex items-center gap-4 mt-5">
            <CarouselPrevious className="relative top-auto left-auto translate-y-0" />
            <CarouselContent className="items-center">
                {genres.map((genre: Genre) => (
                    <CarouselItem className="basis-1/6" key={genre.id}>
                        <Link to={`/genre/${genre.id}-${genre.name.toLowerCase().replace(/ /g, "-")}/tv`}
                            className={buttonVariants({ variant: "secondary", className: "w-full" })}>
                            {genre.name}
                        </Link>
                    </CarouselItem>
                ))}
            </CarouselContent>
            <CarouselNext className="relative top-auto right-auto translate-y-0" />
        </Carousel>
    );
}

export default TVGenreList;