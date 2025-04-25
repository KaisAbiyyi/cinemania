"use client"

import ErrorState from "@/components/ErrorState";
import ImagesCard from "@/feature/media/components/images/ImageCard";
import { cn } from "@/lib/utils";
import { FC } from "react";
import { usePersonImages } from "../hooks/usePersonImages";
import PersonImageWrapperSkeleton from "./skeletons/PersonImageWrapperSkeleton";

interface PersonImageWrapperProps {
    id: number;
}

const PersonImageWrapper: FC<PersonImageWrapperProps> = ({ id }) => {
    const { data, isLoading, error } = usePersonImages({ id });

    if (isLoading) {
        return <PersonImageWrapperSkeleton />;
    }
    if (error || !data) {
        return (
            <ErrorState
                message={error?.message || "There was an error loading the data."}
                onRetry={() => window.location.reload()}
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
