import { FC } from "react";
import { Star, Plus } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { useHeroCarousel } from "../hooks/HeroCarouselProvider";
import { useMediaDetails } from "@/feature/media/hooks/useMediaDetails";

interface HeroMediaInfoProps {
    media: { id: number; media_type?: "movie" | "tv" }[];
}

const HeroMediaInfo: FC<HeroMediaInfoProps> = ({ media }) => {
    const { activeIndex } = useHeroCarousel();
    const activeMedia = media[activeIndex];

    const { data, isLoading, error } = useMediaDetails({
        id: activeMedia.id, // id bertipe number (integer)
        mediaType: activeMedia.media_type ?? "movie", // fallback ke "movie" jika tidak ada
        // Bisa tambahkan parameter tambahan, misalnya language: "en-US"
    });

    if (isLoading) {
        return (
            <div className="flex flex-col justify-end w-full gap-6 md:w-2/3">
                <Skeleton className="h-16 w-96" />
                <Skeleton className="w-24 h-8" />
                <Skeleton className="w-64 h-8" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex flex-col justify-end w-full gap-6 md:w-2/3">
                <p>Error fetching media details.</p>
            </div>
        );
    }

    // Rename data menjadi movieDetail untuk konsistensi
    const movieDetail = data;

    return (
        <div className="flex flex-col justify-end w-full gap-3 md:gap-4 lg:gap-6 lg:w-2/3">
            <h3 className="text-xs font-thin transition-all duration-300 ease-in md:text-sm lg:text-base text-slate-50">DAILY TRENDING</h3>
            <h1 className="text-2xl font-bold transition-all duration-300 ease-in md:text-3xl lg:text-4xl text-primary-foreground">
                {movieDetail.title ?? movieDetail.original_title ?? movieDetail.name}
            </h1>
            <div className="flex gap-4 lg:items-center">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-50">
                    <Star fill="currentColor" size={14} />
                    {movieDetail.vote_average ? movieDetail.vote_average.toFixed(1) : "N/A"}
                </span>
                {movieDetail.genres && movieDetail.genres.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {movieDetail.genres.map((genre: any) => (
                            <Link
                                href={`/genre/${genre.id}-${genre.name.toLowerCase().replace(/ /g, "-")}/${movieDetail.media_type ?? "movie"
                                    }`}
                                className="text-sm font-bold md:text-base text-slate-400 hover:text-slate-100"
                                key={genre.id}
                            >
                                {genre.name}
                            </Link>
                        ))}
                    </div>
                )}
            </div>
            <div className="flex gap-4">
                <Link
                    href={`/${media[activeIndex].media_type ?? "movie"}/${movieDetail.id
                        }-${(movieDetail.title || movieDetail.original_title || movieDetail.name)
                            .toLowerCase()
                            .replace(/ /g, "-")
                            .replace(":", "")}`}
                    className={buttonVariants({ className: "shadow-lg !rounded-full" })}
                >
                    View Details
                </Link>
                <Button variant="secondary" className="rounded-full">
                    <Plus />
                </Button>
            </div>
        </div>
    );
};

export default HeroMediaInfo;
