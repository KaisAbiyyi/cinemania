"use client";

import { FC } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const MediaDetailRecommendationsSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            {/* Section title */}
            <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-28 md:h-8 md:w-32 lg:h-10 lg:w-40" />
            </div>

            {/* Horizontal scroll gallery */}
            <div className="flex flex-row gap-4 pb-6 overflow-x-auto">
                {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="flex-shrink-0 md:w-40 lg:w-52">
                        <div className="flex flex-col gap-2">
                            <Skeleton className="w-full h-[225px] rounded-md" /> {/* Poster */}
                            <Skeleton className="w-3/4 h-4" /> {/* Title */}
                            <Skeleton className="w-1/2 h-3" /> {/* Release date */}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MediaDetailRecommendationsSkeleton;
