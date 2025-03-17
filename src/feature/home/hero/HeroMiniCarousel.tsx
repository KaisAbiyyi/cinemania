import Autoplay from 'embla-carousel-autoplay';
import { FC } from "react";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import HeroMiniCarouselImage from "./HeroMiniCarouselImage";
import { useHeroCarousel } from '../hooks/HeroCarouselProvider';

interface HeroMiniCarouselProps {
    media: { id: number; poster_path: string }[];
}

const HeroMiniCarousel: FC<HeroMiniCarouselProps> = ({ media }) => {
    const { activeIndex, setApi, handleItemClick, } = useHeroCarousel();
    const imgUrl = process.env.NEXT_PUBLIC_TMDB_POSTER_URL;

    
    return (
        <Carousel
            className="w-full h-0 lg:w-1/3 lg:h-fit "
            setApi={setApi}
            opts={{ loop: true }}
            plugins={[Autoplay({ delay: 10000, stopOnInteraction: true })]}
        >
            <CarouselContent className="h-0 p-0 lg:p-2 lg:h-fit">
                {media.map((item, index) => (
                    <CarouselItem
                        key={item.id}
                        className={`basis-1/3 md:block h-0 md:h-fit cursor-pointer md:!w-20 ${activeIndex !== index ? "opacity-50" : "opacity-100"
                            }`}
                        onClick={() => handleItemClick(index)}
                    >
                        <HeroMiniCarouselImage
                            alt={`Poster for media with ID ${item.id}`}
                            className={`${activeIndex === index
                                    ? "transition-none outline-offset-2 outline-2 outline-primary"
                                    : ""
                                }`}
                            src={`${imgUrl}/w500/${item.poster_path}`}
                        />
                    </CarouselItem>
                ))}
            </CarouselContent>
        </Carousel>
    );
};

export default HeroMiniCarousel;
