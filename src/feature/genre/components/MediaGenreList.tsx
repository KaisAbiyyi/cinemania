"use client"

import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import Link from "next/link";
import { buttonVariants } from "../../../components/ui/button";
import { useGenres } from "../hooks/useGenre";
import GenreListSkeleton from "./GenreListSkeleton";
import { Genre } from "@/types/genre";



const MediaGenreList = ({ type }: { type: "movie" | "tv" }) => {
    const { data: genres, isLoading, error } = useGenres(type);
    if (isLoading) return <GenreListSkeleton />;
    if (error) return <p>Error loading genres</p>;

    return (
        <Carousel className="flex items-center gap-4 mt-5" opts={{ dragFree: true }}>
            <CarouselPrevious className="relative top-auto left-auto translate-y-0" />
            <CarouselContent className="items-center">
                {genres.map((genre: Genre) => (
                    <CarouselItem className="basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6 transition-all duration-300 ease-in" key={genre.id}>
                        <Link href={`/genre/${genre.id}-${genre.name.toLowerCase().replace(/ /g, "-")}/tv`}
                            className={buttonVariants({ variant: "secondary", className: "w-full whitespace-pre-wrap text-center" })}>
                            {genre.name}
                        </Link>
                    </CarouselItem>
                ))}
            </CarouselContent>
            <CarouselNext className="relative top-auto right-auto translate-y-0" />
        </Carousel>
    );
};

export default MediaGenreList;