import { useState, FC } from "react";

interface BlurImageProps {
    src: string;
    alt?: string;
    className?: string;
}

const BlurImage: FC<BlurImageProps> = ({ src, alt = "", className }) => {
    const [loading, setLoading] = useState(true);

    return (
        <img
            src={src}
            alt={alt}
            className={`${className} transition-filter duration-500 ${loading ? 'blur-lg' : 'blur-0'}`}
            onLoad={() => setLoading(false)}
            onLoadStart={() => setLoading(true)}
        />
    );
};

export default BlurImage;
