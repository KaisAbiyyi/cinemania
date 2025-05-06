"use client";

import { buttonVariants } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronRight, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FC } from "react";
import { useMediaVideos } from "../../hooks/useMediaVideos";
import MediaDetailVideosSkeleton from "../skeletons/MediaDetailVideosSkeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface MediaDetailVideosProps {
    id: number;
    mediaType: "movie" | "tv";
}

const MediaDetailVideos: FC<MediaDetailVideosProps> = ({ id, mediaType }) => {
    const pathname = usePathname();

    const { data, isLoading, error } = useMediaVideos({
        id,
        mediaType,
    });

    if (isLoading) {
        return <MediaDetailVideosSkeleton />;
    }

    if (error || !data || !data.results.length) {
        return (
            <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
                <div className="flex flex-col gap-2 md:gap-4 lg:gap-8">
                    <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Videos</h1>
                </div>
                <Alert>
                    <AlertDescription>
                        No videos available.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const sortedVideos = data.results
        .sort((a, b) => {
            const priorityTypes = ["Trailer"];
            const aPriority = priorityTypes.includes(a.type) ? 0 : 1;
            const bPriority = priorityTypes.includes(b.type) ? 0 : 1;
            return aPriority - bPriority;
        })
        .slice(0, 4);

    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Videos</h1>
                    <Link
                        href={`${pathname}/videos`}
                        className={buttonVariants({ variant: "ghost", className: "w-fit" })}
                    >
                        View All Videos
                        <ChevronRight />
                    </Link>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                {sortedVideos.map((video) => (
                    <Dialog key={video.id}>
                        <DialogTrigger className="relative">
                            <div className="absolute p-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-950/80 top-1/2 left-1/2 text-slate-100">
                                <Play fill="currentColor" size={36} />
                            </div>
                            <Image
                                alt={video.name}
                                width={480}
                                height={360}
                                className="object-cover w-full h-full rounded-lg"
                                src={`https://img.youtube.com/vi/${video.key}/hqdefault.jpg`}
                            />
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>{video.name}</DialogTitle>
                                <iframe
                                    className="self-stretch w-full mt-4 aspect-video"
                                    src={`https://www.youtube.com/embed/${video.key}`}
                                    frameBorder={0}
                                    title={video.name}
                                    allowFullScreen
                                    aria-hidden="true"
                                />
                            </DialogHeader>
                        </DialogContent>
                    </Dialog>
                ))}
            </div>
            {sortedVideos.length === 0 && (
                <p className="text-muted-foreground">No videos available.</p>
            )}
        </div>
    );
};

export default MediaDetailVideos;
