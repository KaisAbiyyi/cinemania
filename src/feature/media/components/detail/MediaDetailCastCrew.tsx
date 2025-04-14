"use client"

import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FC } from "react";
import { MediaCredits } from "../../hooks/useMediaCredits";
import CastCard from "../CastCard";

interface MediaDetailCastCrewProps {
    data: MediaCredits
    mediaType: "movie" | "tv"
}

const MediaDetailCastCrew: FC<MediaDetailCastCrewProps> = ({ data, mediaType }) => {
    const pathname = usePathname()

    const director = data.crew.find((person) => person.job === "Director");
    const creators = data.crew.filter((person) => person.job === "Creator");


    // Ambil semua kru dari departemen Writing
    const writers = data.crew.filter((person) => person.department === "Writing");

    const topWriters = writers.slice(0, 3);


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
                    {data.cast.slice(0, 10).map((cast, index) => (
                        <CastCard key={index} data={cast} />
                    ))}
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-4 lg:gap-6">
                    {mediaType === "movie" ? (
                        <>
                            <CastCard data={director as MediaCredits["crew"][number]} />
                            {topWriters.map((cast, index) => (
                                <CastCard key={index} data={cast} />
                            ))}
                        </>
                    ) : (
                        <>
                            {creators.map((creator, index) => (
                                <CastCard key={index} data={creator} />
                            ))}
                        </>
                    )}

                </div>
            </div>
        </div>
    );
}

export default MediaDetailCastCrew;