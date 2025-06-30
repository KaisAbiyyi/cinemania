"use client";

import { Label } from "@/components/ui/label";
import { formatRuntime, slugify } from "@/lib/utils";
import { MovieDetail, TVDetail } from "@/types/media";
import { format } from "date-fns";
import { Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FC } from "react";
import { MediaCredits } from "../../hooks/useMediaCredits";
import { MediaReleaseDates } from "../../hooks/useMediaReleaseDates";

import { GeolocationResponse } from "@/feature/geolocation/hooks/useGeolocation";
import { TVContentRatingsResponse } from "../../hooks/useTVContentRating";

type DetailHeaderInfoProps =
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


const DetailHeaderInfo: FC<DetailHeaderInfoProps> = ({ mediaType, data, crewData, releaseData, regionData, contentRatings }) => {
    const isMovie = mediaType === "movie";
    const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL;

    const title =
        (isMovie ? data.title : data.name) ||
        (isMovie ? data.original_title : data.original_name) ||
        "Untitled";

    const posterSrc = data.poster_path
        ? `${imagePath}/w500/${data.poster_path}`
        : "/placeholder.jpg"; // Gambar fallback lokal

    const regionCode = regionData.region ?? "US";

    // Ambil release_date pertama yang valid
    const getValidReleaseDate = (iso: string): string | undefined => {
        const regionEntry = releaseData?.results.find((item) => item.iso_3166_1 === iso);
        return regionEntry?.release_dates.find((rd) => !!rd.release_date)?.release_date;
    };

    // Ambil certification pertama yang valid
    const getValidCertification = (iso: string): string | undefined => {
        const regionEntry = releaseData?.results.find((item) => item.iso_3166_1 === iso);
        return regionEntry?.release_dates.find((rd) => !!rd.certification)?.certification;
    };

    const rawReleaseDate = isMovie
        ? getValidReleaseDate(regionCode) || getValidReleaseDate("US")
        : data.first_air_date;

    const certification = isMovie
        ? getValidCertification(regionCode) || getValidCertification("US")
        : contentRatings?.results.find(r => r.iso_3166_1 === regionCode)?.rating ||
        contentRatings?.results.find(r => r.iso_3166_1 === "US")?.rating;

    console.log(contentRatings)


    const dateFormatted = rawReleaseDate
        ? format(new Date(rawReleaseDate), isMovie ? "MMMM dd, yyyy" : "dd MMMM, yyyy")
        : "Unknown date";



    const genres = data.genres ?? [];
    // Ambil satu director
    const director = crewData.find((person) => person.job === "Director");
    const creators = !isMovie && "created_by" in data ? data.created_by : [];


    // Ambil semua kru dari departemen Writing
    const writers = crewData.filter((person) => person.department === "Writing");

    const topWriters = writers.slice(0, 3);

    const runtime = isMovie ? formatRuntime(data.runtime) : undefined

    return (
        <section aria-label="Media Detail Header" className="text-slate-100">
            {/* Mobile */}
            <div className="block lg:hidden">
                <div className="flex flex-row items-start gap-4">
                    <div className="flex-shrink-0">
                        <Image
                            src={posterSrc}
                            alt={`Poster of ${title}`}
                            width={200}
                            height={350}
                            className="object-cover w-32 transition-all duration-75 ease-in rounded-lg lg:w-56 drop-shadow-lg"
                        />
                    </div>
                    <div className="flex flex-col gap-3">
                        <h1 className="text-lg font-bold md:text-2xl lg:text-3xl">{title}</h1>
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-wrap gap-2 text-sm font-bold">
                                <span className="px-1 text-xs rounded bg-slate-100 text-slate-950">
                                    {certification}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Star fill="currentColor" size={14} />
                                    {data.vote_average.toFixed(1)}
                                </span>
                                <span>{runtime}</span>
                                <span>{dateFormatted}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {genres.map((genre) => (
                                    <Link
                                        key={genre.id}
                                        href={`/genre/${genre.id}-${genre.name.toLowerCase().replace(/ /g, "-")}/${mediaType}`}
                                        className="font-bold md:text-base text-slate-200 hover:text-slate-50 hover:underline"
                                    >
                                        {genre.name}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="mt-4">
                    {data.tagline && (
                        <h2 className="text-base italic text-slate-300 md:text-lg lg:text-xl">
                            {data.tagline}
                        </h2>
                    )}
                    <p className="mt-2">{data.overview}</p>
                    <div className="flex flex-col gap-4 mt-4 text-slate-100">
                        {isMovie && director ? (
                            <>
                                <div className="flex flex-col gap-2">
                                    <Label className="text-xs text-slate-300 md:text-sm">Director</Label>
                                    <h4>
                                        <Link
                                            href={`/person/${director?.id}-${slugify(director?.name as string)}`}
                                            className="font-bold hover:text-slate-50 text-slate-300 hover:underline"
                                        >
                                            {director?.name}
                                        </Link>
                                    </h4>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <Label className="text-xs text-slate-300 lg:text-sm">Writers</Label>
                                    <h4 className="flex flex-wrap items-center text-slate-300 gap-x-1">
                                        {topWriters.map((person, index) => (
                                            <span key={index} className="flex items-center gap-1">
                                                <Link
                                                    href={`/person/${person.id}-${slugify(person.name)}`}
                                                    className="font-bold hover:text-slate-50 hover:underline"
                                                >
                                                    {person.name}
                                                </Link>
                                                {index < topWriters.length - 1 && <span className="text-slate-400">•</span>}
                                            </span>
                                        ))}
                                    </h4>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <Label className="text-xs text-slate-300 lg:text-sm">Creator{creators.length > 1 && "s"}</Label>
                                <h4 className="flex flex-wrap items-center text-slate-300 gap-x-1">
                                    {creators.map((person, index) => (
                                        <span key={index} className="flex items-center gap-1">
                                            <Link
                                                href={`/person/${person.id}-${slugify(person.name)}`}
                                                className="font-bold hover:text-slate-50 hover:underline"
                                            >
                                                {person.name}
                                            </Link>
                                            {index < creators.length - 1 && <span className="text-slate-400">•</span>}
                                        </span>
                                    ))}
                                </h4>
                            </div>
                        )}

                    </div>
                </div>
            </div>

            {/* Desktop */}
            <div className="flex-row items-start hidden gap-8 lg:flex">
                <div className="flex-shrink-0">
                    <Image
                        src={posterSrc}
                        alt={`Poster of ${title}`}
                        width={200}
                        height={350}
                        className="object-cover w-32 transition-all duration-75 ease-in rounded-lg lg:w-56 h-80 drop-shadow-lg"
                    />
                </div>
                <div className="flex flex-col gap-8">
                    <div className="flex flex-col gap-4">
                        <h1 className="text-lg font-bold md:text-2xl lg:text-3xl">{title}</h1>
                        <div className="flex flex-wrap items-center gap-4 text-sm font-bold">
                            <span className="px-1 text-xs rounded bg-slate-100 text-slate-950">
                                {certification}
                            </span>
                            <span className="flex items-center gap-1">
                                <Star fill="currentColor" size={14} />
                                {data.vote_average.toFixed(1)}
                            </span>
                            <span>{runtime}</span>
                            <span>{dateFormatted}</span>
                            <div className="flex flex-wrap gap-2">
                                {genres.map((genre) => (
                                    <Link
                                        key={genre.id}
                                        href={`/genre/${genre.id}-${slugify(genre.name)}/${mediaType}`}
                                        className="font-bold md:text-base text-slate-400 hover:text-slate-50 hover:underline"
                                    >
                                        {genre.name}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        {data.tagline && (
                            <h2 className="text-base italic text-slate-300 md:text-lg lg:text-xl">
                                {data.tagline}
                            </h2>
                        )}
                        <p>{data.overview}</p>
                    </div>
                    <div className="flex gap-6 text-slate-100">
                        {isMovie && director ? (
                            <>
                                <div className="flex flex-col gap-2">
                                    <Label className="text-xs text-slate-300 md:text-sm">Director</Label>
                                    <h4>
                                        <Link
                                            href={`/person/${director?.id}-${slugify(director?.name as string)}`}
                                            className="font-bold hover:text-slate-50 text-slate-300 hover:underline"
                                        >
                                            {director?.name}
                                        </Link>
                                    </h4>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <Label className="text-xs text-slate-300 lg:text-sm">Writers</Label>
                                    <h4 className="flex flex-wrap items-center text-slate-300 gap-x-1">
                                        {topWriters.map((person, index) => (
                                            <span key={index} className="flex items-center gap-1">
                                                <Link
                                                    href={`/person/${person.id}-${slugify(person.name)}`}
                                                    className="font-bold hover:text-slate-50 hover:underline"
                                                >
                                                    {person.name}
                                                </Link>
                                                {index < topWriters.length - 1 && <span className="text-slate-400">•</span>}
                                            </span>
                                        ))}
                                    </h4>
                                </div>
                            </>
                        ) : (
                            creators.length > 0 && (
                                <div className="flex flex-col gap-2">
                                    <Label className="text-xs text-slate-300 lg:text-sm">Creator{creators.length > 1 && "s"}</Label>
                                    <h4 className="flex flex-wrap items-center text-slate-300 gap-x-1">
                                        {creators.map((person, index) => (
                                            <span key={index} className="flex items-center gap-1">
                                                <Link
                                                    href={`/person/${person.id}-${slugify(person.name)}`}
                                                    className="font-bold hover:text-slate-50 hover:underline"
                                                >
                                                    {person.name}
                                                </Link>
                                                {index < creators.length - 1 && <span className="text-slate-400">•</span>}
                                            </span>
                                        ))}
                                    </h4>
                                </div>
                            )
                        )}

                    </div>
                </div>
            </div>
        </section>
    );
};

export default DetailHeaderInfo;
