import Image from "next/image";
import { FC } from "react";
import { MediaImages } from "../../hooks/useMediaImages";

interface ImagesCardProps {
    data: MediaImages["posters"][number]
}

const DEFAULT_TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const ImagesCard: FC<ImagesCardProps> = ({ data }) => {
    const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL || DEFAULT_TMDB_IMAGE_BASE;

    if (!data.file_path) {
        return null;
    }

    const normalizedFilePath = data.file_path.startsWith("/") ? data.file_path : `/${data.file_path}`;

    return (
        <a href={`${imagePath}/original${normalizedFilePath}`} target="_blank" rel="noopener noreferrer">
            <Image
                alt={data.file_path}
                width={480}
                height={360}
                className="object-cover w-full h-full rounded-lg"
                src={`${imagePath}/w500${normalizedFilePath}`}
            />
        </a>
    );
}

export default ImagesCard;