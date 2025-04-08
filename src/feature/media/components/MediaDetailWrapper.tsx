"use client";

import React from "react";
import { useMediaDetails } from "../hooks/useMediaDetails";
import MediaDetailHeader from "./MediaDetailHeader";
import { MovieDetail, TVDetail } from "@/types/media";

interface MediaDetailProps {
    id: number;
    mediaType: "movie" | "tv";
}

const MediaDetailWrapper: React.FC<MediaDetailProps> = ({ id, mediaType }) => {
    // Memanggil hook untuk mengambil detail media
    const { data, isLoading, error } = useMediaDetails({ id, mediaType, language: "en-US" });

    if (isLoading) {
        return <p>Loading movie details...</p>;
    }

    if (error) {
        return <p>Error loading movie details.</p>;
    }

    if (!data) {
        return <p>No data available.</p>;
    }

    // Lakukan pengecekan untuk menentukan tipe data berdasarkan mediaType
    if (mediaType === "movie") {
        const movieData = data as MovieDetail;
        return (
            <div className="flex flex-col gap-8">
                <MediaDetailHeader data={movieData} mediaType="movie" />
            </div>
        );
    } else if (mediaType === "tv") {
        const tvData = data as TVDetail;
        return (
            <div className="flex flex-col gap-8">
                <MediaDetailHeader data={tvData} mediaType="tv" />
            </div>
        );
    }

    return null;
};

export default MediaDetailWrapper;
