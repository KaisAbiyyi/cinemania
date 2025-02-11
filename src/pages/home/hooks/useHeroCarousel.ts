import { useEffect, useState } from "react";
import { CarouselApi } from "@/components/ui/carousel";

export const useHeroCarousel = (moviesLength: number) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [api, setApi] = useState<CarouselApi>();

    useEffect(() => {
        if (!api) return;

        api.on("select", () => {
            setActiveIndex(api.selectedScrollSnap());
            setLoading(true);
        });
    }, [api]);

    const handleImageLoad = () => {
        setLoading(false);
    };

    const handleItemClick = (index: number) => {
        if (api) {
            const currentIndex = api.selectedScrollSnap();
            const lastIndex = moviesLength - 1;

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

    const handlePrev = () => {
        if (api) {
            api.scrollPrev();
        }
    };

    const handleNext = () => {
        if (api) {
            api.scrollNext();
        }
    };

    return {
        activeIndex,
        loading,
        setApi,
        handleImageLoad,
        handleItemClick,
        handlePrev,
        handleNext,
    };
};
