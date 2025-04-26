"use client";

import { FC } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

const SearchWrapperSkeleton: FC = () => {
    const renderSkeletonCards = (count: number, layout: "horizontal" | "vertical") => (
        <div
            className={`grid gap-4 ${layout === "horizontal"
                ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
                : "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
                }`}
        >
            {Array.from({ length: count }).map((_, index) => (
                <Skeleton key={index} className="w-full h-48" />
            ))}
        </div>
    );

    return (
        <Tabs defaultValue="movie" className="w-full">
            <TabsList>
                <TabsTrigger value="movie">Movies (Loading...)</TabsTrigger>
                <TabsTrigger value="tv">TV (Loading...)</TabsTrigger>
                <TabsTrigger value="person">People (Loading...)</TabsTrigger>
                <TabsTrigger value="keyword">Keywords (Loading...)</TabsTrigger>
            </TabsList>

            {/* Movies Tab */}
            <TabsContent value="movie" className="mt-4">
                {renderSkeletonCards(12, "horizontal")}
            </TabsContent>

            {/* TV Tab */}
            <TabsContent value="tv" className="mt-4">
                {renderSkeletonCards(12, "horizontal")}
            </TabsContent>

            {/* People Tab */}
            <TabsContent value="person" className="mt-4">
                {renderSkeletonCards(6, "vertical")}
            </TabsContent>

            {/* Keywords Tab */}
            <TabsContent value="keyword" className="mt-4">
                <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 10 }).map((_, index) => (
                        <Skeleton key={index} className="w-24 h-8" />
                    ))}
                </div>
            </TabsContent>
        </Tabs>
    );
};

export default SearchWrapperSkeleton;