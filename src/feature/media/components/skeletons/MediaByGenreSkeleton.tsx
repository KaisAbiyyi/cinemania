"use client";

import { FC } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const CARD_COUNT = 6;

const MediaByGenreSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-6">
            <div className="w-48">
                <Skeleton className="w-full h-10" />
            </div>
            {[...Array(1)].map((_, pageIndex) => (
                <div key={pageIndex} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {Array.from({ length: CARD_COUNT }).map((_, index) => (
                        <div
                            key={index}
                            className="flex flex-row w-full overflow-hidden rounded-lg drop-shadow-md bg-secondary animate-pulse"
                        >
                            {/* Poster */}
                            <Skeleton className="w-36 md:w-40 h-[216px]" />

                            {/* Content */}
                            <div className="flex flex-col justify-between w-full p-3">
                                <div className="flex flex-col gap-2">
                                    <Skeleton className="w-3/4 h-5" />
                                    <Skeleton className="w-1/4 h-3" />
                                </div>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    <Skeleton className="w-16 h-5 rounded-full" />
                                    <Skeleton className="w-20 h-5 rounded-full" />
                                </div>
                                <Skeleton className="w-full h-10 mt-2" />
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

export default MediaByGenreSkeleton;
