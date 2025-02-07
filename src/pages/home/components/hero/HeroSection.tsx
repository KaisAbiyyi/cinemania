import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { useHeroMovies } from "../../hooks/useHeroMovies";
import HeroBackground from "./HeroBackground";
import { ChevronRight } from "lucide-react";
import { FC } from "react";
import HeroMovieInfo from "./HeroMovieInfo";
import HeroMiniCarousel from "./HeroMiniCarousel";
import { HeroCarouselProvider } from "../../hooks/HeroCarouselProvider";

const HeroSection: FC = () => {
    const { data: movies, isPending, error } = useHeroMovies();

    if (isPending) return <h1>Loading...</h1>;
    if (error || !movies || movies.length === 0) return <h1>Failed to load movies.</h1>;

    return (
        <HeroCarouselProvider moviesLength={movies.length}>
            <Card className="relative overflow-hidden">
                <HeroBackground movies={movies} />
                <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-slate-950 to-slate-950/10">
                    <CardHeader className="flex flex-row justify-end">
                        <Link to={'/trending'} className={buttonVariants({ variant: "secondary", className: "w-fit" })}>
                            More
                            <ChevronRight />
                        </Link>
                    </CardHeader>
                    <CardHeader className="flex-row items-end justify-between">
                        <HeroMovieInfo movies={movies} />
                        <HeroMiniCarousel movies={movies} />
                    </CardHeader>
                </div>
            </Card>
        </HeroCarouselProvider>
    );
};

export default HeroSection;
