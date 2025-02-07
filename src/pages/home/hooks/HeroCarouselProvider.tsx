import { createContext, useContext, useEffect, useState, FC } from "react";
import { CarouselApi } from "@/components/ui/carousel";

interface HeroCarouselContextProps {
    activeIndex: number;
    setApi: (api: CarouselApi) => void;
    handleItemClick: (index: number) => void;
}

const HeroCarouselContext = createContext<HeroCarouselContextProps | undefined>(undefined);

export const useHeroCarousel = () => {
    const context = useContext(HeroCarouselContext);
    if (!context) {
        throw new Error("useHeroCarousel must be used within a HeroCarouselProvider");
    }
    return context;
};

export const HeroCarouselProvider: FC<{ children: React.ReactNode; moviesLength: number }> = ({ children }) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [api, setApi] = useState<CarouselApi | null>(null);

    useEffect(() => {
        if (!api) return;

        api.on("select", () => {
            setActiveIndex(api.selectedScrollSnap());
        });
    }, [api]);

    const handleItemClick = (index: number) => {
        if (api) {
            api.scrollTo(index);
            setActiveIndex(index);
        }
    };

    return (
        <HeroCarouselContext.Provider value={{ activeIndex, setApi, handleItemClick }}>
            {children}
        </HeroCarouselContext.Provider>
    );
};
