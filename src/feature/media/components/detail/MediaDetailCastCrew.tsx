"use client";

import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FC } from "react";
import { MediaCredits } from "../../hooks/useMediaCredits";
import { useMediaAggregateCredits } from "../../hooks/useMediaAggregateCredits";
import CastCard from "../CastCard";
import { MovieDetail, TVDetail } from "@/types/media";
import MediaCastCrewSkeleton from "../skeletons/MediaCastCrewSkeleton";

type MediaDetailCastCrewProps =
    | {
        mediaType: "movie";
        data: MediaCredits;
        mediaData: MovieDetail;
    }
    | {
        mediaType: "tv";
        data: MediaCredits;
        mediaData: TVDetail;
    };

const MediaDetailCastCrew: FC<MediaDetailCastCrewProps> = ({ data, mediaType, mediaData }) => {
    const pathname = usePathname();
    const isMovie = mediaType === "movie";

    const director = data.crew.find((person) => person.job === "Director");
    const creators = !isMovie && "created_by" in mediaData ? mediaData.created_by : [];

    // Ambil semua kru dari departemen Writing
    const writers = data.crew.filter((person) => person.department === "Writing");
    const topWriters = writers.slice(0, 3);

    // Gunakan hook untuk TV aggregate credits hanya jika mediaType adalah "tv"
    const { data: aggregateCredits, isLoading } = useMediaAggregateCredits({ id: mediaData.id, enabled: !isMovie });

    // Tentukan sumber data cast
    const cast = isMovie ? data.cast : aggregateCredits?.cast || [];

    // Tampilkan skeleton loading jika sedang memuat data
    if (!isMovie && isLoading) {
        return <MediaCastCrewSkeleton />;
    }

    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Top Cast</h1>
                    <Link href={`${pathname}/cast`} className={buttonVariants({ variant: "ghost", className: "w-fit" })}>
                        View Full Cast & Crew
                        <ChevronRight />
                    </Link>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-4 lg:gap-6">
                    {cast.slice(0, 10).map((castMember, index) => {
                        if (isMovie) {
                            return <CastCard key={index} data={castMember as MediaCredits["cast"][number]} mediaType="movie" />;
                        }
                        return <CastCard key={index} data={castMember} mediaType="tv" />;
                    })}
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-4 lg:gap-6">
                    {mediaType === "movie" ? (
                        <>
                            {director && <CastCard data={director as MediaCredits["crew"][number]} mediaType="movie" />}
                            {topWriters.map((writer, index) => (
                                <CastCard key={index} data={writer} mediaType="movie" />
                            ))}
                        </>
                    ) : (
                        <>
                            {creators && creators.map((creator, index) => (
                                <CastCard key={index} data={creator} mediaType="tv" />
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MediaDetailCastCrew;