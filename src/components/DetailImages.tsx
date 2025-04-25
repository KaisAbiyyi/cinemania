"use client";

import { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { useMediaImages } from "../feature/media/hooks/useMediaImages";
import { usePersonImages } from "../feature/person/hooks/usePersonImages";
import MediaDetailImagesSkeleton from "../feature/media/components/skeletons/MediaDetailImagesSkeleton";
import { getImageSizeClasses, selectAppropriateImages } from "../feature/media/utils/selectAppropriateImage";
import { cn } from "@/lib/utils";

interface DetailImagesProps {
    id: number;
    type: "media" | "person";
    mediaType?: "movie" | "tv"; // Required only if type is "media"
    className?: string;
}

const DetailImages: FC<DetailImagesProps> = ({ id, type, mediaType, className }) => {
    const pathname = usePathname();

    // Fetch data based on the type
    const { data, isLoading, error } =
        type === "media"
            ? useMediaImages({ id, mediaType: mediaType! })
            : usePersonImages({ id });

    if (isLoading) return <MediaDetailImagesSkeleton />;
    if (error || !data) return <p className="text-muted-foreground">Failed to load images.</p>;

    // Select best images based on their appropriate type and orientation
    const selectedImages =
        type === "media" && "backdrops" in data && "posters" in data
            ? selectAppropriateImages(data.backdrops || [], data.posters || [], [])
            : "profiles" in data
                ? selectAppropriateImages([], [], data.profiles || [])
                : [];

    // Calculate total remaining images
    const totalImages =
        type === "media"
            ? ("backdrops" in data && "posters" in data ? (data.backdrops?.length || 0) + (data.posters?.length || 0) : 0)
            : type === "person" && "profiles" in data
                ? data.profiles?.length || 0
                : 0;
    const remainingImages = totalImages - selectedImages.length;

    return (
        <div className={cn("flex flex-col gap-4 sm:gap-6", className)}>
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
                                        alt={`Image ${index + 1}`}
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

export default DetailImages;
