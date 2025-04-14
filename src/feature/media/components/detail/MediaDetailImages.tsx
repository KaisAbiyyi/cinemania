"use client";

import { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { useMediaImages } from "../../hooks/useMediaImages";
import MediaDetailImagesSkeleton from "../skeletons/MediaDetailImagesSkeleton";
import { getImageSizeClasses, selectAppropriateImages } from "../../utils/selectAppropriateImage";

interface MediaDetailImagesProps {
    id: number;
    mediaType: "movie" | "tv";
}

const MediaDetailImages: FC<MediaDetailImagesProps> = ({ id, mediaType }) => {
    const pathname = usePathname();
    const { data, isLoading, error } = useMediaImages({ id, mediaType });

    if (isLoading) return <MediaDetailImagesSkeleton />;
    if (error || !data) return <p className="text-muted-foreground">Failed to load images.</p>;

    // Select best images based on their appropriate type and orientation
    const selectedImages = selectAppropriateImages(data.backdrops || [], data.posters || []);

    // Calculate total remaining images
    const totalImages = (data.backdrops?.length || 0) + (data.posters?.length || 0);
    const remainingImages = totalImages - selectedImages.length;

    return (
        <div className="flex flex-col gap-4 sm:gap-6">
            <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Photos</h1>
                <Link
                    href={`${pathname}/images`}
                    className={buttonVariants({ variant: "ghost", className: "w-fit" })}
                >
                    View All Images
                    <ChevronRight className="w-4 h-4" />
                </Link>
            </div>

            {selectedImages.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 auto-rows-[200px] sm:auto-rows-[160px] md:auto-rows-[180px]">
                    {selectedImages.map((image, index) => {
                        const sizeClass = getImageSizeClasses(index);

                        return (
                            <div key={index} className={`relative overflow-hidden rounded-md ${sizeClass}`}>
                                <div className="relative w-full h-full">
                                    <Image
                                        src={`https://image.tmdb.org/t/p/w780${image.file_path}`}
                                        alt={`Media image ${index + 1}`}
                                        fill
                                        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                                        className="object-cover transition-transform duration-300 hover:scale-105"
                                    />
                                    {index === selectedImages.length - 1 && remainingImages > 0 && (
                                        <Link href={`${pathname}/images`} className="absolute inset-0 flex items-center justify-center bg-black/60">
                                            <span className="text-xl font-bold text-white">+{remainingImages}</span>
                                        </Link>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">No images available.</p>
            )}
        </div>
    );
};



export default MediaDetailImages;