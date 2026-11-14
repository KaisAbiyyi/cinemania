"use client"

import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";
import ImagesCard from "@/feature/media/components/images/ImageCard";
import { cn } from "@/lib/utils";
import { FC } from "react";
import { usePersonImages } from "../hooks/usePersonImages";
import PersonImageWrapperSkeleton from "./skeletons/PersonImageWrapperSkeleton";

interface PersonImageWrapperProps {
    id: number;
}

const PersonImageWrapper: FC<PersonImageWrapperProps> = ({ id }) => {
    const { data, isLoading, error, refetch } = usePersonImages({ id });

    if (isLoading) {
        return (
            <div role="status" aria-label="Loading person images">
                <PersonImageWrapperSkeleton />
            </div>
        );
    }
    if (error) {
        return (
            <ErrorState
                message={error.message || "There was an error loading the data."}
                onRetry={() => void refetch()}
            />
        );
    }
    if (!data || data.profiles.length === 0) {
        return (
            <EmptyState
                title="No images"
                message="No profile images available."
            />
        );
    }

    return (
        <div className={cn("grid grid-cols-2 gap-4", "lg:grid-cols-3")}>
            {data.profiles.map((img) => (
                <ImagesCard key={img.file_path} data={img} />
            ))}
        </div>
    );
};

export default PersonImageWrapper;
