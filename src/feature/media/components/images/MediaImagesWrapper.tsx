"use client"

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
    const { data, isLoading, error } = useMediaImages({ id, mediaType });

    if (isLoading) {
        return <MediaImagesWrapperSkeleton />;
    }
    if (error || !data) {
        return <div>Error loading images</div>;
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
                    <div className={cn("grid grid-cols-2 gap-4", image.type === "backdrop" ? "lg:grid-cols-2" : "lg:grid-cols-3")}>
                        {image.data.map((img) => (
                            <ImagesCard key={img.file_path} data={img} />
                        ))}
                    </div>
                </TabsContent>
            ))}
        </Tabs>
    );
}

export default MediaImagesWrapper;