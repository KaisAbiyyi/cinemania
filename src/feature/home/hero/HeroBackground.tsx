import Image from "next/image";
import { FC, useState, useEffect } from "react";
import { useHeroCarousel } from "../hooks/HeroCarouselProvider";

interface HeroBackgroundProps {
    movies: { backdrop_path: string; title: string, name: string }[];
}

const HeroBackground: FC<HeroBackgroundProps> = ({ movies }) => {
    const { activeIndex } = useHeroCarousel();
    const imgUrl = process.env.NEXT_PUBLIC_TMDB_POSTER_URL;
    const [loading, setLoading] = useState(true);

    // Reset loading state saat active index berubah
    useEffect(() => {
        setLoading(true);
    }, [activeIndex]);

    return (
        <Image
            src={`${imgUrl}/original/${movies[activeIndex].backdrop_path}`}
            alt={movies[activeIndex].title ?? movies[activeIndex].name ?? "Media Background"}
            width={1920} // Sesuaikan dengan lebar yang diinginkan
            height={700} // Sama dengan h-[700px]
            priority
            onLoadingComplete={() => setLoading(false)}
            className={`h-[50vh] md:h-[700px] w-full object-cover transition-all duration-300 ${loading ? "blur-lg" : "blur-0"
                }`}
        />
    );
};

export default HeroBackground;
