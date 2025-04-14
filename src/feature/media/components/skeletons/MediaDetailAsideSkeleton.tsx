"use client";

import { FC } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const MediaDetailAsideSkeleton: FC = () => {
    return (
        <aside className="flex flex-col w-full gap-2 md:gap-4 md:w-1/3 lg:gap-6 xl:gap-8">
            {/* Status */}
            <div className="flex flex-col gap-2">
                <Skeleton className="w-24 h-4" /> {/* Label */}
                <Skeleton className="w-32 h-5" /> {/* Value */}
            </div>

            {/* Original Language */}
            <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-36" /> {/* Label */}
                <Skeleton className="w-24 h-5" /> {/* Value */}
            </div>

            {/* Budget */}
            <div className="flex flex-col gap-2">
                <Skeleton className="w-20 h-4" /> {/* Label */}
                <Skeleton className="h-5 w-28" /> {/* Value */}
            </div>

            {/* Revenue */}
            <div className="flex flex-col gap-2">
                <Skeleton className="w-24 h-4" /> {/* Label */}
                <Skeleton className="h-5 w-36" /> {/* Value */}
            </div>

            {/* Keywords */}
            <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-28" /> {/* Label */}
                <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="w-20 h-8 rounded-md" />
                    ))}
                </div>
            </div>
        </aside>
    );
};

export default MediaDetailAsideSkeleton;
