import { FC } from "react";
import { useHeroCarousel } from "../../hooks/HeroCarouselProvider";

interface HeroBackgroundProps {
    movies: { backdrop_path: string; title: string }[];
}

const HeroBackground: FC<HeroBackgroundProps> = ({ movies }) => {
    const { activeIndex } = useHeroCarousel();
    const imgUrl = import.meta.env.VITE_TMDB_POSTER_URL;

    return (
        <img
            src={`${imgUrl}/original/${movies[activeIndex].backdrop_path}`}
            className="h-[70vh] w-full object-cover transition-filter duration-500"
            alt={movies[activeIndex].title}
        />
    );
};

export default HeroBackground;
