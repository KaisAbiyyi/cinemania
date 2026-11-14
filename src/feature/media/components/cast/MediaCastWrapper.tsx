"use client";

import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";

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

    const {
        data: credits,
        isLoading: isCreditsLoading,
        error: creditsError,
        refetch: refetchCredits,
    } = useMediaCredits({ id, mediaType });
    const {
        data: aggregateCredits,
        isLoading: isAggregateLoading,
        error: aggregateError,
        refetch: refetchAggregate,
    } = useMediaAggregateCredits({
        id,
        enabled: mediaType === "tv",
    });

    if (isCreditsLoading || (mediaType === "tv" && isAggregateLoading)) {
        return (
            <div role="status" aria-label="Loading cast and crew">
                <MediaCastSkeleton />
            </div>
        );
    }

    const queryError = creditsError || (mediaType === "tv" ? aggregateError : null);
    if (queryError) {
        return (
            <ErrorState
                message={queryError.message || "Failed to load cast and crew."}
                onRetry={() => {
                    void refetchCredits();
                    if (mediaType === "tv") {
                        void refetchAggregate();
                    }
                }}
            />
        );
    }

    const cast = mediaType === "movie"
        ? credits?.cast || []
        : aggregateCredits?.cast.map((member) => ({
            ...member,
            character: member.roles?.[0]?.character || "",
            order: 0, // Default order value if not available
        })) || [];
    const crew = credits?.crew || [];

    if (cast.length === 0 && crew.length === 0) {
        return (
            <EmptyState
                title="No cast or crew"
                message="No cast or crew credits are available for this title."
            />
        );
    }

    return (
        <div className="flex flex-col gap-6 md:flex-row">
            <Cast cast={cast} mediaType={mediaType} />
            <Crew crew={crew} mediaType={mediaType} />
        </div>
    );
};

export default MediaCastWrapper;