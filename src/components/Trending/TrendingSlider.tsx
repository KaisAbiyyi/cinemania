import Autoplay from "embla-carousel-autoplay";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FC, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "../ui/button";
import { Carousel, CarouselApi, CarouselContent, CarouselItem } from "../ui/carousel";
import CarouselImage from "./TrendingCarouselImage";
import SlideInfo from "./TrendingSlideInfo";

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
            setLoading(true)
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
                className={`h-[60vh] object-cover transition-filter duration-500 ${loading ? 'blur-lg' : 'blur-0'}`}
                alt={sliderData[activeIndex].title ?? sliderData[activeIndex].name ?? sliderData[activeIndex].original_name}
                onLoad={handleImageLoad}
                onLoadStart={() => setLoading(true)}
            />
            <div className="absolute inset-0 flex flex-col justify-end w-full h-full gap-4 p-4 lg:p-8 lg:gap-24 lg:justify-between lg:flex-row bg-gradient-to-t from-background via-background/70 to-transparent/50">
                <div className="flex justify-between lg:hidden">
                    <Button size="icon" variant="ghost" className="hover:bg-secondary/50" onClick={() => { console.log("Prev button clicked"); api && api.scrollPrev(); }}><ChevronLeft /></Button>
                    <Button size="icon" variant="ghost" className="hover:bg-secondary/50" onClick={() => { console.log("Next button clicked"); api && api.scrollNext(); }}><ChevronRight /></Button>
                </div>
                <SlideInfo id={sliderData[activeIndex].id} detailType={sliderData[activeIndex].media_type} />
                <div className="flex flex-col items-end justify-between gap-8">
                    <Link to={'/trending'} className={buttonVariants({ variant: "ghost", className: "!rounded-full !font-bold order-last lg:order-first" })}>MORE <ChevronRight size={16} /></Link>
                    <Carousel className="!w-full h-0 lg:h-fit p-0" setApi={setApi} opts={{ loop: true }} plugins={[Autoplay({ delay: 10000, stopOnInteraction: true })]}>
                        <CarouselContent className="h-0 p-0 lg:p-2 lg:h-fit">
                            {sliderData.map((item: any, index: number) => (
                                <CarouselItem
                                    key={item.id}
                                    className={`basis-1/3 lg:block h-0 lg:h-fit cursor-pointer lg:!w-20 ${activeIndex !== index ? "opacity-50" : "opacity-100"}`}
                                    onClick={() => handleItemClick(index)}>
                                    <CarouselImage className={`${activeIndex === index ? "outline transition-none outline-offset-2 outline-2 outline-primary" : ''}`} src={`${imgUrl}/w500/${item.poster_path}`} />
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
