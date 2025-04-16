"use client"

import { FC } from "react";
import { useMediaVideos } from "../../hooks/useMediaVideos";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VideoCard from "./VideoCard";
import MediaVideosWrapperSkeleton from "../skeletons/MediaVideosWrapperSkeleton";

interface MediaVideosWrapperProps {
    id: number;
    mediaType: "movie" | "tv";
}

const MediaVideosWrapper: FC<MediaVideosWrapperProps> = ({ id, mediaType }) => {
    const { data, isLoading, error } = useMediaVideos({ id, mediaType });

    if (isLoading) {
        return <MediaVideosWrapperSkeleton />;
    }

    if (error || !data) {
        return <div>Error loading videos</div>;
    }

    const Videos = [
        {
            type: "Trailer",
            data: data.results.filter((video) => video.type === "Trailer"),
        },
        {
            type: "Teaser",
            data: data.results.filter((video) => video.type === "Teaser"),
        },
        {
            type: "Clip",
            data: data.results.filter((video) => video.type === "Clip"),
        },
        {
            type: "Behind the Scenes",
            data: data.results.filter((video) => video.type === "Behind the Scenes"),
        },
        {
            type: "Featurette",
            data: data.results.filter((video) => video.type === "Featurette"),
        },
        {
            type: "Bloopers",
            data: data.results.filter((video) => video.type === "Bloopers"),
        },
    ]



    return (
        <Tabs defaultValue="Trailer" className="w-full">
            <TabsList>
                {Videos.map((video) => (
                    <TabsTrigger key={video.type} value={video.type}>
                        {video.type}  {video.data.length}
                    </TabsTrigger>
                ))}
            </TabsList>
            {Videos.map((video) => (
                <TabsContent key={video.type} value={video.type} className="mt-6">
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                        {video.data.map((video) => (
                            <VideoCard data={video} key={video.id} />
                        ))}
                    </div>
                    {video.data.length === 0 && (
                        <p className="text-muted-foreground">No {video.type} available.</p>
                    )}
                </TabsContent>
            ))}
        </Tabs>
    );
}

export default MediaVideosWrapper;