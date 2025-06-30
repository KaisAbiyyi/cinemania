import Image from "next/image";
import Link from "next/link";
import { FC } from "react";
import { MediaImages } from "../../hooks/useMediaImages";

interface ImagesCardProps {
    data: MediaImages["posters"][number]
}

const ImagesCard: FC<ImagesCardProps> = ({ data }) => {
    const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL || "https://default-image-path.com/";

    if (!data.file_path) {
        console.error("Invalid file path for image:", data);
        return null; // Return null to avoid rendering invalid images
    }

    return (
        <Link href={`${imagePath}/original/${data.file_path}`} target="_blank">
            <Image
                alt={data.file_path}
                width={480}
                height={360}
                className="object-cover w-full h-full rounded-lg"
                src={`${imagePath}/w500/${data.file_path}`}
            />
        </Link>
    );
}

export default ImagesCard;