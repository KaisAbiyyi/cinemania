"use client"

import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { FC } from "react";
import { useMediaImages } from "../../hooks/useMediaImages";
import ImagesCard from "./ImageCard";
import MediaImagesWrapperSkeleton from "../skeletons/MediaImagesWrapperSkeleton";

interface MediaImagesWrapperProps {
    id: number;
    mediaType: "movie" | "tv"
}

const MediaImagesWrapper: FC<MediaImagesWrapperProps> = ({ id, mediaType }) => {
    const { data, isLoading, error, refetch } = useMediaImages({ id, mediaType });

    if (isLoading) {
        return (
            <div role="status" aria-label="Loading images">
                <MediaImagesWrapperSkeleton />
            </div>
        );
    }
    if (error) {
        return (
            <ErrorState
                message={error.message || "Error loading images."}
                onRetry={() => void refetch()}
            />
        );
    }
    if (!data || (data.backdrops.length === 0 && data.posters.length === 0)) {
        return <EmptyState title="No images" message="No images available for this title." />;
    }

    const images = [
        {
            type: "backdrop",
            data: data.backdrops,
            title: "Backdrops",
        },
        {
            type: "poster",
            data: data.posters,
            title: "Posters",
        },
    ]


    return (
        <Tabs defaultValue="backdrop" className="w-full">
            <TabsList >
                {images.map((image) => (
                    <TabsTrigger key={image.type} value={image.type}>
                        {image.title} {image.data.length}
                    </TabsTrigger>
                ))}
            </TabsList>
            {images.map((image) => (
                <TabsContent key={image.type} value={image.type}>
                    {image.data.length === 0 ? (
                        <EmptyState title={`No ${image.title.toLowerCase()}`} message={`No ${image.title.toLowerCase()} available.`} />
                    ) : (
                        <div className={cn("grid grid-cols-2 gap-4", image.type === "backdrop" ? "lg:grid-cols-2" : "lg:grid-cols-3")}>
                            {image.data.map((img) => (
                                <ImagesCard key={img.file_path} data={img} />
                            ))}
                        </div>
                    )}
                </TabsContent>
            ))}
        </Tabs>
    );
}

export default MediaImagesWrapper;