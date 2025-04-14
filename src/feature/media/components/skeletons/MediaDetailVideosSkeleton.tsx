"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const MediaDetailVideosSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            {/* Header */}
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                <div className="flex justify-between items-center">
                    <Skeleton className="h-8 w-32" /> {/* Title */}
                    <Skeleton className="h-8 w-28" /> {/* Button */}
                </div>
            </div>

            {/* Video Thumbnails */}
            <div className="grid grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="relative w-full aspect-video rounded-lg overflow-hidden">
                        <Skeleton className="w-full h-full object-cover rounded-lg" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                            <Skeleton className="h-14 w-14 rounded-full bg-slate-800/80" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MediaDetailVideosSkeleton;
