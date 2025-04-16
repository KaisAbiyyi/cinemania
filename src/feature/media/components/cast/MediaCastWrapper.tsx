"use client";

import { FC } from "react";
import { usePathname } from "next/navigation";
import { useMediaCredits } from "@/feature/media/hooks/useMediaCredits";
import { useMediaAggregateCredits } from "@/feature/media/hooks/useMediaAggregateCredits";
import Cast from "./Cast";
import Crew from "./Crew";
import MediaCastSkeleton from "../skeletons/MediaCastSkeleton";

interface MediaCastWrapperProps {
    id: number;
}

const MediaCastWrapper: FC<MediaCastWrapperProps> = ({ id }) => {
    const pathname = usePathname();
    const mediaType = pathname.includes("/movie/") ? "movie" : "tv";

    const { data: credits, isLoading: isCreditsLoading } = useMediaCredits({ id, mediaType });
    const { data: aggregateCredits, isLoading: isAggregateLoading } = useMediaAggregateCredits({
        id,
        enabled: mediaType === "tv",
    });

    if (isCreditsLoading || (mediaType === "tv" && isAggregateLoading)) {
        return <MediaCastSkeleton />;
    }

    const cast = mediaType === "movie"
        ? credits?.cast || []
        : aggregateCredits?.cast.map((member) => ({
            ...member,
            character: member.roles?.[0]?.character || "",
            order: 0, // Default order value if not available
        })) || [];
    const crew = credits?.crew || [];

    return (
        <div className="flex flex-col gap-6 md:flex-row">
            <Cast cast={cast} mediaType={mediaType} />
            <Crew crew={crew} mediaType={mediaType} />
        </div>
    );
};

export default MediaCastWrapper;