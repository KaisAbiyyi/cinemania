"use client"

import { MovieDetail, TVDetail } from "@/types/media";
import Image from "next/image";
import { FC } from "react";// pastikan path ini sesuai dengan lokasi file type-mu
import DetailHeaderInfo from "./DetailHeaderInfo";

// Discriminated union untuk props komponen berdasarkan mediaType
type MediaDetailHeaderProps =
    | { mediaType: "movie"; data: MovieDetail }
    | { mediaType: "tv"; data: TVDetail };

const MediaDetailHeader: FC<MediaDetailHeaderProps> = ({ data, mediaType }) => {
    const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL;

    // Karena properti judul berbeda pada movie dan TV (misalnya movie menggunakan 'title' sedangkan TV menggunakan 'name'),
    // kita bisa menentukan nilai title berdasarkan mediaType.
    const title = mediaType === "movie" ? data.title : data.name;
    const backdropPath = data.backdrop_path;

    return (
        <header className="relative overflow-hidden rounded-lg">
            <Image
                className="h-[50vh] md:h-[700px] w-full object-cover"
                alt={title}
                src={`${imagePath}/original/${backdropPath}`}
                width={1080}
                height={720}
            />
            <div className="absolute inset-0 p-2 md:p-4 lg:p-6 xl:p-8 gap-2 md:gap-4 lg:gap-6 xl:gap-8 bg-gradient-to-t from-indigo-950 via-indigo-950/80 to-indigo-950/50 flex transition-all duration-75 items-start ease-in lg:items-end">
                {mediaType === "movie" ?
                    <DetailHeaderInfo mediaType="movie" data={data} /> :
                    <DetailHeaderInfo mediaType="tv" data={data} />
                }
            </div>
        </header>
    );
};

export default MediaDetailHeader;
