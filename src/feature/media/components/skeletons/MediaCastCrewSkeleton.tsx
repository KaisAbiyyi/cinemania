"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const MediaCastCrewSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-8 w-32" />
                </div>

                {/* Top 10 Cast Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 lg:gap-6">
                    {Array.from({ length: 10 }).map((_, i) => (
                        <Skeleton key={i} className="h-24 w-full rounded-lg" />
                    ))}
                </div>

                {/* Separator */}
                <Skeleton className="h-px w-full bg-border" />

                {/* Director + Writers */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 lg:gap-6">
                    <Skeleton className="h-24 w-full rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                </div>
            </div>
        </div>
    );
};

export default MediaCastCrewSkeleton;
