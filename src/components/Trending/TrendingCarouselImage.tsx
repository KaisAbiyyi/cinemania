import { cn } from "@/lib/utils";
import { FC, useState } from "react";

interface CarouselImageProps {
    src: string;
    className?: string
}

const CarouselImage: FC<CarouselImageProps> = ({ src, className }) => {
    const [loading, setLoading] = useState(true);

    return (
        <img
            src={src}
            alt=""
            className={cn(`rounded-md transition-filter duration-500 ${loading ? 'blur-lg' : 'blur-0'}`, className)}
            onLoad={() => setLoading(false)}
            onLoadStart={() => setLoading(true)}
        />
    );
};

export default CarouselImage;