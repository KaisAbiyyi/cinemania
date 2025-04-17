"use client";

import { useGenres } from "@/feature/genre/hooks/useGenre";
import { cn, getPosterImageUrl } from "@/lib/utils";
import { Genre } from "@/types/genre";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import { Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FC, HTMLAttributes } from "react";
import { Badge } from "../../../components/ui/badge";
import { CardDescription, CardHeader } from "../../../components/ui/card";

interface MediaCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "id"> {
    id: number;
    title: string;
    posterPath: string;
    rating: number;
    releaseDate: string;
    mediaType: "movie" | "tv";
    description?: string;
    genre_ids?: number[];
    layout?: "vertical" | "horizontal";
}

const MediaCard: FC<MediaCardProps> = ({
    id,
    title,
    posterPath,
    releaseDate,
    rating,
    mediaType,
    description,
    genre_ids = [],
    layout = "vertical",
    className,
    ...props
}) => {
    const { data: genresData, isPending } = useGenres(mediaType);

    const genres = genresData?.filter((genre: Genre) => genre_ids.includes(genre.id)) || [];


    // Format tanggal menggunakan date-fns
    const formattedDate = releaseDate ? format(new Date(releaseDate), "MMM d, yyyy", { locale: enUS }) : "Unknown";

    return (
        <article
            className={cn(
                "relative overflow-hidden rounded-lg transition-all duration-75 shadow  ease-in",
                layout === "horizontal"
                    ? "h-72 md:h-80 w-full"
                    : "flex flex-row w-full drop-shadow-md",
                className
            )}
            {...props}
        >
            {/* Poster */}
            <Image
                src={`${getPosterImageUrl(posterPath)}`}
                alt={title}
                width={layout === "vertical" ? 500 : 160}
                height={layout === "vertical" ? 720 : 240}
                className={cn(
                    "object-cover",
                    layout === "horizontal" ? "w-full h-full" : "w-36 md:w-40"
                )}
                priority
            />

            {/* Overlay untuk vertical layout */}
            {layout === "horizontal" && (
                <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-slate-950 to-transparent">
                    <CardHeader className="flex flex-row items-center justify-between p-3">
                        <Badge variant="secondary" className="flex gap-2 text-yellow-500">
                            <Star size={10} fill="currentColor" />
                            <span className="font-bold text-slate-950 dark:text-slate-50">{rating.toFixed(1)}</span>
                        </Badge>
                    </CardHeader>
                    <CardHeader className="p-3">
                        <h2 className="text-lg font-bold text-slate-200">{title}</h2>
                        <CardDescription className="text-sm text-slate-400">
                            <time dateTime={releaseDate}>{formattedDate}</time>
                        </CardDescription>
                    </CardHeader>
                </div>
            )}

            {/* Konten untuk horizontal layout */}
            {layout === "vertical" && (
                <div className="flex flex-col flex-grow p-3 bg-gradient-to-bl via-transparent from-secondary/50 to-transparent">
                    <div className="flex flex-col gap-2">
                        <h2 className="text-lg font-bold ">{title}</h2>
                        <CardDescription className="text-xs">
                            <time dateTime={releaseDate}>{formattedDate}</time>
                        </CardDescription>
                    </div>

                    {/* Badge Rating */}
                    <Badge className="absolute top-2 right-2">{rating.toFixed(1)}</Badge>

                    {/* Genre List */}
                    <div className="z-10 flex gap-2 mt-1">
                        {isPending
                            ? <span className="text-xs text-gray-500">Loading genres...</span>
                            : genres.map((genre: Genre) => (
                                <Link
                                    key={genre.id}
                                    href={`/genre/${genre.id}-${genre.name.toLowerCase().replace(/ /g, "-")}/${mediaType}`}
                                    className="text-sm font-bold text-slate-500 hover:text-slate-400"
                                >
                                    {genre.name}
                                </Link>
                            ))}
                    </div>

                    {/* Deskripsi */}
                    {description && <CardDescription className="mt-2">{description}</CardDescription>}
                </div>
            )}

            {/* Link ke Detail */}
            <Link
                href={`/${mediaType}/${id}-${title.toLowerCase().replace(/ /g, "-").replace(":", "")}`}
                className="absolute inset-0"
                aria-label={`View details for ${title}`}
            />
        </article>
    );
};

export default MediaCard;
