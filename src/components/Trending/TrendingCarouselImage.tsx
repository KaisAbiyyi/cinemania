import { FC, useState } from "react";

interface CarouselImageProps {
    src: string;
}

const CarouselImage: FC<CarouselImageProps> = ({ src }) => {
    const [loading, setLoading] = useState(true);

    return (
        <img
            src={src}
            alt=""
            className={`rounded-md transition-filter duration-500 ${loading ? 'blur-lg' : 'blur-0'}`}
            onLoad={() => setLoading(false)}
            onLoadStart={() => setLoading(true)}
        />
    );
};

export default CarouselImage;