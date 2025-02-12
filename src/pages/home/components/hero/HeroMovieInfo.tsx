import { FC } from "react";
import { Star, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useHeroCarousel } from "../../hooks/HeroCarouselProvider";
import { useMovieDetail } from "@/hooks/useMovieDetail";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";

interface HeroMovieInfoProps {
    movies: { id: number; media_type?: string }[];
}

const HeroMovieInfo: FC<HeroMovieInfoProps> = ({ movies }) => {
    const { activeIndex } = useHeroCarousel();
    const activeMovie = movies[activeIndex];

    const { movieDetail, isLoading } = useMovieDetail(activeMovie.media_type ?? "movie", activeMovie.id);

    if (isLoading) {
        return (
            <div className="flex flex-col justify-end w-full gap-6 md:w-2/3">
                <Skeleton className="h-16 w-96" />
                <Skeleton className="w-24 h-8" />
                <Skeleton className="w-64 h-8" />
            </div>
        );
    }

    if (!movieDetail) return null;

    return (
        <div className="flex flex-col justify-end w-full gap-6 md:w-2/3">
            <h3 className="text-sm font-thin lg:text-lg text-slate-50">DAILY TRENDING</h3>
            <h1 className="text-2xl font-bold lg:text-5xl text-primary-foreground">
                {movieDetail.title ?? movieDetail.original_title ?? movieDetail.name}
            </h1>
            <div className="flex gap-4 lg:items-center">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-50">
                    <Star fill="currentColor" size={14} />
                    {movieDetail.vote_average ? movieDetail.vote_average.toFixed(1) : "N/A"}
                </span>
                {movieDetail.genres && movieDetail.genres.length > 0 && (
                    <div className="flex gap-2">
                        {movieDetail.genres.map((genre:any) => (
                            <Link
                                to={`/genre/${genre.id}-${genre.name.toLowerCase().replace(/ /g, "-")}/${movieDetail.media_type ?? "movie"}`}
                                className="font-bold text-slate-400 hover:text-slate-100"
                                key={genre.id}
                            >
                                {genre.name}
                            </Link>
                        ))}
                    </div>
                )}
            </div>
            <div className="flex gap-4">
                <Link to={`/${movieDetail.media_type ?? "movie"}/${movieDetail.id}-${(movieDetail.title || movieDetail.original_title || movieDetail.name).toLowerCase().replace(/ /g, "-").replace(":", "")}`} className={buttonVariants({ className: "shadow-lg !rounded-full" })}>
                    View Details
                </Link>
                <Button variant="secondary" className="rounded-full"><Plus /></Button>
            </div>
        </div>
    );
};

export default HeroMovieInfo;
