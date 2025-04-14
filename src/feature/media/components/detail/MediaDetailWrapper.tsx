"use client";

import { useGeolocation } from "@/feature/geolocation/hooks/useGeolocation";
import { MovieDetail, TVDetail } from "@/types/media";
import dynamic from "next/dynamic";
import React, { Suspense } from "react";
import { useMediaCredits } from "../../hooks/useMediaCredits";
import { MediaDetails, useMediaDetails } from "../../hooks/useMediaDetails";
import { MediaReleaseDates, useMediaReleaseDates } from "../../hooks/useMediaReleaseDates";
import MediaDetailHeader from "./MediaDetailHeader";
import MediaCastCrewSkeleton from "../skeletons/MediaCastCrewSkeleton";
import MediaDetailHeaderSkeleton from "../skeletons/MediaDetailHeaderSkeleton";
import MediaDetailImagesSkeleton from "../skeletons/MediaDetailImagesSkeleton";
import MediaDetailReviewsSkeleton from "../skeletons/MediaDetailReviewsSkeleton";
import MediaDetailVideosSkeleton from "../skeletons/MediaDetailVideosSkeleton";
import MediaDetailSimilarSkeleton from "../skeletons/MediaDetailSimilarSkeleton";
import MediaDetailRecommendationsSkeleton from "../skeletons/MediaDetailRecommendationsSkeleton";
import MediaDetailAside from "./MediaDetailAside";
import { TVContentRatingsResponse, useTVContentRatings } from "../../hooks/useTVContentRating";

const MediaDetailReviews = dynamic(() => import("./MediaDetailReviews"), {
    ssr: false,
});

const MediaDetailVideos = dynamic(() => import("./MediaDetailVideos"), {
    ssr: false,
});

const MediaDetailCastCrew = dynamic(() => import("./MediaDetailCastCrew"), {
    ssr: false
})

const MediaDetailImages = dynamic(() => import("./MediaDetailImages"), {
    ssr: false,
});

const MediaDetailRecommendations = dynamic(() => import("./MediaDetailRecommendations"), {
    ssr: false,
});
const MediaDetailSimilar = dynamic(() => import("./MediaDetailSimilar"), {
    ssr: false,
});


interface MediaDetailProps {
    id: number;
    mediaType: "movie" | "tv";
}

const MediaDetailWrapper: React.FC<MediaDetailProps> = ({ id, mediaType }) => {
    const {
        data: detailData,
        isLoading: detailLoading,
        error: detailError,
    } = useMediaDetails({ id, mediaType, language: "en-US" });

    const {
        data: creditsData,
        isLoading: creditsLoading,
        error: creditsError,
    } = useMediaCredits({ id, mediaType, language: "en-US" });

    const releaseQuery = mediaType === "movie" ?
        useMediaReleaseDates({ id, mediaType }) :
        { data: null, isLoading: false, error: null };

    const releaseData = releaseQuery.data;
    const releaseLoading = releaseQuery.isLoading;
    const releaseError = releaseQuery.error;

    const contentRatingsQuery = mediaType === "tv" ?
        useTVContentRatings(id) :
        { data: null, isLoading: false, error: null };

    const contentRatings = contentRatingsQuery.data;
    const contentRatingsLoading = contentRatingsQuery.isLoading;
    const contentRatingsError = contentRatingsQuery.error


    const {
        data: regionData,
        isLoading: langLoading,
        error: langError,
    } = useGeolocation();



    const isPrimaryLoading =
        detailLoading || creditsLoading || (mediaType === "movie" && releaseLoading) || (mediaType === "tv" && contentRatingsLoading) || langLoading;
    const isPrimaryError =
        detailError || creditsError || (mediaType === "movie" && releaseError) || (mediaType === "tv" && contentRatingsError) || langError;
    const isPrimaryNoData =
        !detailData || !creditsData || (mediaType === "movie" && !releaseData) || (mediaType === "tv" && !contentRatings) || !regionData;

    if (isPrimaryLoading || isPrimaryError || isPrimaryNoData) {
        const message = isPrimaryLoading
            ? <MediaDetailHeaderSkeleton />
            : isPrimaryError
                ? "Error loading media details."
                : "No data available.";
        return message;
    }
    const crew = creditsData.crew as MediaDetails["crew"];
    const releaseDates = releaseData;
    const region = regionData;

    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            {mediaType === "movie" ? (
                <MediaDetailHeader
                    data={detailData as MovieDetail}
                    crewData={crew}
                    releaseData={releaseDates as MediaReleaseDates}
                    regionData={region}
                    mediaType="movie"
                />
            ) : (
                <MediaDetailHeader
                    data={detailData as TVDetail}
                    crewData={crew}
                    contentRatings={contentRatings as TVContentRatingsResponse}
                    regionData={region}
                    mediaType="tv"
                />
            )}


            <div className="flex flex-col gap-4 lg:flex-row md:gap-6 lg:gap-8 xl:gap-10">
                <div className="flex flex-col w-full gap-4 lg:w-2/3 md:gap-6 lg:gap-8 xl:gap-10">
                    <Suspense fallback={<MediaCastCrewSkeleton />}>
                        <MediaDetailCastCrew data={creditsData} mediaType={mediaType} />
                    </Suspense>
                    <Suspense fallback={<MediaDetailReviewsSkeleton />}>
                        <MediaDetailReviews id={id} mediaType={mediaType} />
                    </Suspense>
                    <Suspense fallback={<MediaDetailVideosSkeleton />}>
                        <MediaDetailVideos id={id} mediaType={mediaType} />
                    </Suspense>
                    <Suspense fallback={<MediaDetailImagesSkeleton />}>
                        <MediaDetailImages id={id} mediaType={mediaType} />
                    </Suspense>
                    <Suspense fallback={<MediaDetailRecommendationsSkeleton />}>
                        <MediaDetailRecommendations id={id} mediaType={mediaType} />
                    </Suspense>
                    <Suspense fallback={<MediaDetailSimilarSkeleton />}>
                        <MediaDetailSimilar id={id} mediaType={mediaType} />
                    </Suspense>
                </div>
                <Suspense fallback={<MediaDetailHeaderSkeleton />}>
                    <MediaDetailAside id={id} mediaType={mediaType} detailData={detailData} />
                </Suspense>
            </div>
        </div>
    );
};

export default MediaDetailWrapper;