"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const MediaDetailImagesSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-4 sm:gap-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <Skeleton className="w-32 h-8" /> {/* Title */}
                <Skeleton className="h-8 w-28" /> {/* Button */}
            </div>

            {/* Gallery Skeleton Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 auto-rows-[200px] sm:auto-rows-[160px] md:auto-rows-[180px]">
                {Array.from({ length: 9 }).map((_, index) => {
                    const sizeClass = getSkeletonSizeClasses(index);
                    return (
                        <div key={index} className={`relative overflow-hidden rounded-md ${sizeClass}`}>
                            <Skeleton className="object-cover w-full h-full" />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// Sama dengan logic dari getImageSizeClasses
function getSkeletonSizeClasses(index: number): string {
    const base = "col-span-1";

    switch (index) {
        case 0: return `${base} sm:col-span-3 sm:row-span-2`;
        case 1: return `${base} sm:col-span-3`;
        case 2: return `${base} sm:col-span-2`;
        case 3: return `${base} sm:col-span-1 sm:row-span-1`;
        case 4: return `${base} sm:col-span-2`;
        case 5: return `${base} sm:col-span-2`;
        case 6: return `${base} sm:col-span-2`;
        case 7: return `${base} sm:col-span-3`;
        case 8: return `${base} sm:col-span-3`;
        default: return base;
    }
}

export default MediaDetailImagesSkeleton;
