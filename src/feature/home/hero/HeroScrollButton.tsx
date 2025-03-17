import { FC } from "react";
import { useHeroCarousel } from "../hooks/HeroCarouselProvider";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeroScrollButtonProps {
    direction: "next" | "prev"
    className?: string
}

const HeroScrollButton: FC<HeroScrollButtonProps> = ({ direction, className }) => {
    const { handleScroll } = useHeroCarousel()
    return (
        <Button size={"icon"} className={cn("hover:bg-secondary/25 cursor-pointer transition-all ease-in duration-75 text-slate-100", className)} variant="ghost" onClick={() => handleScroll(direction)}>
            {direction === "prev" ? <ChevronLeft /> : <ChevronRight />}
        </Button>
    )
}

export default HeroScrollButton;