"use client";

import { FC } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

const VIDEO_TYPES = ["Trailer", "Teaser", "Clip", "Behind the Scenes", "Featurette", "Bloopers"];

const MediaVideosWrapperSkeleton: FC = () => {
    return (
        <Tabs defaultValue="Trailer" className="w-full">
            <TabsList>
                {VIDEO_TYPES.map((type) => (
                    <TabsTrigger key={type} value={type} disabled>
                        <Skeleton className="h-5 w-[100px]" />
                    </TabsTrigger>
                ))}
            </TabsList>
            {VIDEO_TYPES.map((type) => (
                <TabsContent key={type} value={type} className="mt-6">
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div className="flex flex-col gap-4" key={index}>
                                <div className="relative">
                                    <Skeleton className="w-full h-[200px] rounded-lg" />
                                    <div className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2">
                                        <Skeleton className="rounded-full h-9 w-9" />
                                    </div>
                                </div>
                                <div className="flex justify-between gap-2 px-2">
                                    <Skeleton className="w-1/2 h-5" />
                                    <Skeleton className="w-1/4 h-4" />
                                </div>
                            </div>
                        ))}
                    </div>
                </TabsContent>
            ))}
        </Tabs>
    );
};

export default MediaVideosWrapperSkeleton;
