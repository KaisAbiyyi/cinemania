import { FC } from "react";
import CastCard from "@/feature/media/components/cast/CastCard";
import { MediaCredits } from "@/feature/media/hooks/useMediaCredits";

interface CastProps {
    cast: MediaCredits["cast"];
    mediaType: "movie" | "tv";
}

const Cast: FC<CastProps> = ({ cast, mediaType }) => {
    return (
        <div className="flex flex-col gap-8">
            <h2 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Cast</h2>
            <div className="grid grid-cols-2 gap-4">
                {cast.map((castMember, index) => (
                    <CastCard key={index} data={castMember} mediaType={mediaType} />
                ))}
            </div>
        </div>
    );
};

export default Cast;