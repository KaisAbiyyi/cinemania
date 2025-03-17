import Image from "next/image";
import { cn } from "@/lib/utils";
import { FC, useState } from "react";

interface HeroMiniCarouselImageProps {
    src: string;
    className?: string;
    alt?: string;
}

const HeroMiniCarouselImage: FC<HeroMiniCarouselImageProps> = ({
    src,
    className,
    alt = "",
}) => {
    const [loading, setLoading] = useState(true);

    return (
        <Image
            src={src}
            alt={alt}
            width={500} // Sesuaikan nilai width sesuai kebutuhan
            height={750} // Sesuaikan nilai height sesuai kebutuhan
            className={cn(
                `rounded-md h-10 md:h-fit md:w-fit w-full object-cover transition-filter duration-500 ${loading ? 'blur-lg' : 'blur-0'}`,
                className
            )}
            onLoadingComplete={() => setLoading(false)}
        />
    );
};

export default HeroMiniCarouselImage;
