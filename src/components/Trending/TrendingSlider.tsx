import Autoplay from "embla-carousel-autoplay";
import { FC, useEffect, useState } from "react";
import { Carousel, CarouselApi, CarouselContent, CarouselItem } from "../ui/carousel";
import CarouselImage from "./TrendingCarouselImage";
import SlideInfo from "./TrendingSlideInfo";
import { Link } from "react-router-dom";
import { buttonVariants } from "../ui/button";
import { ChevronRight } from "lucide-react";

interface TrendingSliderProps {
    data: any;
}

const TrendingSlider: FC<TrendingSliderProps> = ({ data }) => {
    const imgUrl = import.meta.env.VITE_TMDB_POSTER_URL;
    const sliderData = data.results.slice(0, 5);

    const [activeIndex, setActiveIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [api, setApi] = useState<CarouselApi>();

    useEffect(() => {
        if (!api) {
            return;
        }

        api.on("select", () => {
            setActiveIndex(api.selectedScrollSnap());
        });
    }, [api]);

    const handleImageLoad = () => {
        setLoading(false);
    };

    const handleItemClick = (index: number) => {
        if (api) {
            const currentIndex = api.selectedScrollSnap();
            const lastIndex = sliderData.length - 1;

            if (index === 0 && currentIndex === lastIndex) {
                api.scrollNext();
            } else if (index === lastIndex && currentIndex === 0) {
                api.scrollPrev();
            } else if (index > currentIndex || (currentIndex === lastIndex && index === 0)) {
                api.scrollNext();
            } else if (index < currentIndex || (currentIndex === 0 && index === lastIndex)) {
                api.scrollPrev();
            }
            setActiveIndex(index);
        }
    };

    return (
        <div className="relative flex flex-col h-[700px] overflow-hidden">
            <img
                src={`${imgUrl}/original/${sliderData[activeIndex].backdrop_path}`}
                className={`h-[700px] object-cover transition-filter duration-500 ${loading ? 'blur-lg' : 'blur-0'}`}
                alt={sliderData[activeIndex].title ?? sliderData[activeIndex].name ?? sliderData[activeIndex].original_name}
                onLoad={handleImageLoad}
                onLoadStart={() => setLoading(true)}
            />
            <div className="absolute inset-0 flex flex-col justify-between w-full h-full gap-24 p-16 lg:flex-row bg-gradient-to-t from-background to-primary/30">
                <SlideInfo id={sliderData[activeIndex].id} detailType={sliderData[activeIndex].media_type} />
                <div className="flex flex-col items-end justify-between gap-8">
                    <Link to={'/trending'} className={buttonVariants({ variant: "secondary", className: "!rounded-full" })}>More <ChevronRight size={16} /></Link>
                    <Carousel className="!w-full" setApi={setApi} opts={{ loop: true }} plugins={[Autoplay({ delay: 10000, stopOnInteraction: true })]}>
                        <CarouselContent>
                            {sliderData.map((item: any, index: number) => (
                                <CarouselItem key={item.id} className={`basis-1/3 !w-20 ${activeIndex !== index ? "opacity-50 cursor-pointer" : "opacity-100"}`} onClick={() => handleItemClick(index)}>
                                    <CarouselImage src={`${imgUrl}/w500/${item.poster_path}`} />
                                </CarouselItem>
                            ))}
                        </CarouselContent>
                    </Carousel>
                </div>
            </div>
        </div>
    );
};

export default TrendingSlider;
