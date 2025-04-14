"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const MediaDetailReviewsSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            {/* Header */}
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                <div className="flex justify-between items-center">
                    <Skeleton className="h-8 w-40" /> {/* Title */}
                    <Skeleton className="h-8 w-32" /> {/* Button */}
                </div>
            </div>

            {/* Review Card */}
            <div className="bg-transparent">
                <div className="flex flex-col gap-4 md:gap-6">
                    {/* Header */}
                    <div className="flex items-start justify-between px-4 pt-4">
                        <div className="flex flex-row gap-2 md:gap-4 lg:gap-6 items-center">
                            <Skeleton className="h-10 w-10 rounded-full" />
                            <div className="flex flex-col gap-1 md:gap-2">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-24" />
                                <Skeleton className="h-3 w-20" />
                            </div>
                        </div>
                        <Skeleton className="h-5 w-10 rounded bg-primary" />
                    </div>

                    {/* Content */}
                    <div className="px-4 pb-4">
                        <div className="flex flex-col gap-2">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-5/6" />
                            <Skeleton className="h-4 w-4/6" />
                            <Skeleton className="h-4 w-3/6" />
                        </div>
                        <Skeleton className="h-4 w-24 mt-4" />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MediaDetailReviewsSkeleton;
