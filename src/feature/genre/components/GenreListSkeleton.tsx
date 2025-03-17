import { FC } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

const GenreListSkeleton: FC = () => {
    return (
        <Carousel className="w-full flex mt-5 gap-4 items-center" opts={{ dragFree: true }}>
            <CarouselPrevious className="relative top-auto left-auto translate-y-0" />
            <div className="w-full">
                <CarouselContent className="flex-1 grow">
                    {Array.from({ length: 7 }).map((_, index) => (
                        <CarouselItem
                            key={index}
                            className="basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6 transition-all duration-300 ease-in"
                        >
                            <Skeleton className="w-full h-10" />
                        </CarouselItem>
                    ))}
                </CarouselContent>
            </div>
            <CarouselNext className="relative top-auto right-auto translate-y-0" />
        </Carousel>
    );
}

export default GenreListSkeleton;
