import Autoplay from 'embla-carousel-autoplay';
import { FC } from "react";
import { useHeroCarousel } from "../../hooks/HeroCarouselProvider";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import HeroMiniCarouselImage from "./HeroMiniCarouselImage";

interface HeroMiniCarouselProps {
    movies: { id: number; poster_path: string }[];
}

const HeroMiniCarousel: FC<HeroMiniCarouselProps> = ({ movies }) => {
    const { activeIndex, setApi, handleItemClick } = useHeroCarousel();
    const imgUrl = import.meta.env.VITE_TMDB_POSTER_URL;

    return (
        <Carousel className="w-1/3 h-0 p-0 lg:h-fit" setApi={setApi} opts={{ loop: true }} plugins={[Autoplay({ delay: 10000, stopOnInteraction: true })]}>
            <CarouselContent className="h-0 p-0 lg:p-2 lg:h-fit">
                {movies.map((movie, index) => (
                    <CarouselItem
                        key={movie.id}
                        className={`basis-1/3 lg:block h-0 lg:h-fit cursor-pointer lg:!w-20 ${activeIndex !== index ? "opacity-50" : "opacity-100"}`}
                        onClick={() => handleItemClick(index)}
                    >
                        <HeroMiniCarouselImage className={`${activeIndex === index ? "outline transition-none outline-offset-2 outline-2 outline-primary" : ''}`} src={`${imgUrl}/w500/${movie.poster_path}`} />
                    </CarouselItem>
                ))}
            </CarouselContent>
        </Carousel>
    );
};

export default HeroMiniCarousel;
