import { format, getYear } from "date-fns";
import Autoplay from "embla-carousel-autoplay";
import { FC, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "../ui/button";
import { Carousel, CarouselApi, CarouselContent, CarouselItem } from "../ui/carousel";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { formatDurationFromMinutes } from "@/lib/utils";
import { Star } from "lucide-react";
import { Skeleton } from "../ui/skeleton";

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
                <div className="flex items-end gap-4">
                    <Carousel className="!w-full" setApi={setApi} opts={{ loop: true }} plugins={[Autoplay({ delay: 10000, stopOnInteraction: true })]}>
                        <CarouselContent>
                            {sliderData.map((item: any, index: number) => (
                                <CarouselItem key={item.id} className={`basis-1/3 !w-24 ${activeIndex !== index ? "opacity-50 cursor-pointer" : "opacity-100"}`} onClick={() => handleItemClick(index)}>
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

interface CarouselImageProps {
    src: string;
}

const CarouselImage: FC<CarouselImageProps> = ({ src }) => {
    const [loading, setLoading] = useState(true);

    return (
        <img
            src={src}
            alt=""
            className={`rounded-md transition-filter duration-500 ${loading ? 'blur-lg' : 'blur-0'}`}
            onLoad={() => setLoading(false)}
            onLoadStart={() => setLoading(true)}
        />
    );
};

interface SlideInfoProps {
    id: number;
    detailType: string;
}

const SlideInfo: FC<SlideInfoProps> = ({ id, detailType }) => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const { data: Info, isPending: InfoPending } = useQuery({
        queryKey: [`get${detailType}Detail${id}Info`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return data;
        },
    });

    if (InfoPending) {
        return (
            <div className="flex flex-col justify-center gap-6">
                <Skeleton className="h-16 w-96" />
                <div className="flex flex-col gap-2 lg:items-center lg:flex-row">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="w-8 h-8" />
                            <Skeleton className="w-8 h-8" />
                        </div>
                        <Skeleton className="w-24 h-8" />
                        {detailType === "movie" && <Skeleton className="w-16 h-8" />}
                    </div>
                    <div className="flex items-center gap-2">
                        <Skeleton className="w-16 h-8" />
                        <Skeleton className="w-16 h-8" />
                        <Skeleton className="w-16 h-8" />
                    </div>
                </div>
                <div className="flex gap-4">
                    <Button className="rounded-full" disabled>View Details</Button>
                    <Button variant="secondary" className="rounded-full" disabled>Add to list</Button>
                </div>
                <Skeleton className="w-64 h-8" />
            </div>
        );
    }

    return (
        <div className="flex flex-col justify-center gap-6">
            <h1 className="flex gap-2 text-2xl font-bold lg:text-4xl text-primary lg:text-primary-foreground">
                {Info.title ?? Info.original_title ?? Info.name}
                <span className="font-normal">({getYear(Info.release_date ?? Info.first_air_date)})</span>
            </h1>
            <div className="flex flex-col gap-2 lg:items-center lg:flex-row">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                        <Star fill="currentColor" size="18" />
                        {Info.vote_average.toFixed(1)}
                    </div>
                    <time className="text-xs font-semibold lg:text-sm text-primary lg:text-primary-foreground">
                        {format(new Date(Info.release_date ?? Info.first_air_date), "MMM d, yyyy")}
                    </time>
                    {detailType === "movie" && (
                        <time className="text-xs font-semibold lg:text-sm text-primary lg:text-primary-foreground">
                            {formatDurationFromMinutes(Info.runtime)}
                        </time>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {Info.genres.map((item: any) => (
                        <Link
                            to={`/genre/${item.id}-${(item.name as string).toLowerCase().replace(/ /g, "-")}/${detailType}`}
                            className="px-2 py-1 text-xs font-bold duration-200 ease-out rounded-sm lg:text-primary lg:bg-primary-foreground bg-primary text-primary-foreground hover:shadow-md hover:shadow-primary-foreground"
                            key={item.id}
                        >
                            {item.name}
                        </Link>
                    ))}
                </div>
            </div>
            <div className="flex gap-4">
                <Link to={`/${Info.media_type ?? detailType}/${Info.id}-${((Info.title || Info.original_title || Info.name) as string).toLowerCase().replace(/ /g, "-").replace(":", "")}`} className={buttonVariants({ className: "shadow-lg !rounded-full" })}>View Details</Link>
                <Button variant="secondary" className="rounded-full">Add to list</Button>
            </div>
            <i className="text-xl italic font-thin text-background-foreground lg:text-primary-foreground">
                {Info.tagline}
            </i>
        </div>
    );
}

export default TrendingSlider;
