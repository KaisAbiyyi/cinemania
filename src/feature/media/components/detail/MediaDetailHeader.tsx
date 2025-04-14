"use client";

import { GeolocationResponse } from "@/feature/geolocation/hooks/useGeolocation";
import { MovieDetail, TVDetail } from "@/types/media";
import Image from "next/image";
import { FC } from "react";
import { MediaCredits } from "../../hooks/useMediaCredits";
import { MediaReleaseDates } from "../../hooks/useMediaReleaseDates";
import DetailHeaderInfo from "./DetailHeaderInfo";
import { TVContentRatingsResponse } from "../../hooks/useTVContentRating";

type MediaDetailHeaderProps =
    | {
        mediaType: "movie";
        data: MovieDetail;
        crewData: MediaCredits["crew"];
        releaseData?: MediaReleaseDates;
        contentRatings?: TVContentRatingsResponse;
        regionData: GeolocationResponse;
    }
    | {
        mediaType: "tv";
        data: TVDetail;
        crewData: MediaCredits["crew"];
        releaseData?: MediaReleaseDates;
        contentRatings?: TVContentRatingsResponse;
        regionData: GeolocationResponse;
    };

const MediaDetailHeader: FC<MediaDetailHeaderProps> = ({
    data,
    mediaType,
    crewData,
    releaseData,
    regionData,
}) => {
    const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL;
    const isMovie = mediaType === "movie";

    const title =
        (isMovie ? data.title : data.name) ||
        (isMovie ? data.original_title : data.original_name) ||
        "Untitled";

    const backdropPath = data.backdrop_path;
    const hasBackdrop = backdropPath && imagePath;

    return (
        <header className="relative overflow-hidden rounded-lg">
            {hasBackdrop ? (
                <Image
                    className="h-[50vh] md:h-[700px] w-full object-cover"
                    alt={`Backdrop of ${title}`}
                    src={`${imagePath}/original/${backdropPath}`}
                    width={1080}
                    height={720}
                    priority
                />
            ) : (
                <div className="h-[50vh] md:h-[700px] w-full bg-slate-800 flex items-center justify-center">
                    <span className="text-slate-200">No backdrop image available</span>
                </div>
            )}

            <div className="absolute inset-0 flex items-start gap-2 p-2 transition-all duration-75 ease-in md:p-4 lg:p-6 xl:p-8 md:gap-4 lg:gap-6 xl:gap-8 bg-gradient-to-t from-slate-950 via-slate-950/90 to-indigo-950/30 lg:items-end">
                {isMovie ? (
                    <DetailHeaderInfo
                        mediaType="movie"
                        data={data}
                        crewData={crewData}
                        releaseData={releaseData}
                        regionData={regionData}
                    />
                ) : (
                    <DetailHeaderInfo
                        mediaType="tv"
                        data={data}
                        crewData={crewData}
                        releaseData={releaseData}
                        regionData={regionData}
                    />
                )}
            </div>
        </header>
    );
};

export default MediaDetailHeader;
