import { Genre } from "@/types/genre";
import { MovieDetail, TVDetail } from "@/types/media";
import { formatDate } from "date-fns";
import { Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FC } from "react";

type DetailHeaderInfoProps =
    | { mediaType: "movie"; data: MovieDetail }
    | { mediaType: "tv"; data: TVDetail };

const DetailHeaderInfo: FC<DetailHeaderInfoProps> = ({ mediaType, data }) => {
    const title = mediaType === "movie" ? data.title : data.name;
    const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL;
    const dateFormatted = mediaType === "movie" ? formatDate(new Date(data.release_date), "MMMM dd, yyyy") : formatDate(new Date(data.first_air_date), "dd MMMM, yyyy")
    console.log(data)
    return (
        <section aria-label="Media Detail Header">
            {/* Layout untuk layar kecil (mobile):
                - Row pertama: gambar dan judul berdampingan
                - Row kedua: tagline (jika ada) dan overview di bawah */}
            <div className="block lg:hidden">
                <div className="flex flex-row items-start gap-4">
                    <div className="flex-shrink-0">
                        <Image
                            src={`${imagePath}/w500/${data.poster_path}`}
                            alt={`Poster of ${title}`}
                            width={200}
                            height={350}
                            className="w-32 lg:w-56 rounded-lg drop-shadow-lg object-cover transition-all duration-75 ease-in"
                        />
                    </div>
                    <div>
                        <h1 className="text-base md:text-lg lg:text-xl font-bold text-slate-100">
                            {title}
                        </h1>
                        <div className="flex flex-col gap-2 my-2">
                            <div className="flex gap-2 flex-wrap font-bold text-sm text-slate-100">
                                <span className="flex gap-1 items-center">
                                    <Star fill="currentColor" size={14} />
                                    {data.vote_average.toFixed(1)}
                                </span>
                                <span>{dateFormatted}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {data.genres.map((genre: Genre) => (
                                    <Link
                                        href={`/genre/${genre.id}-${genre.name.toLowerCase().replace(/ /g, "-")}/${mediaType ?? "movie"
                                            }`}
                                        className="font-bold md:text-base text-slate-400 hover:text-slate-100"
                                        key={genre.id}
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
                        <h2 className="text-slate-300 italic text-base md:text-lg lg:text-xl">
                            {data.tagline}
                        </h2>
                    )}
                    <p className="text-slate-100 mt-2">{data.overview}</p>
                </div>
            </div>

            {/* Layout untuk layar besar (desktop):
                - Seluruh konten ditampilkan dalam satu baris, dengan gambar di sebelah kiri
                  dan kolom teks (judul, tagline, overview) di sebelah kanan */}
            <div className="hidden lg:flex flex-row gap-6 items-start">
                <div className="flex-shrink-0">
                    <Image
                        src={`${imagePath}/w500/${data.poster_path}`}
                        alt={`Poster of ${title}`}
                        width={200}
                        height={350}
                        className="w-32 lg:w-56 rounded-lg drop-shadow-lg object-cover transition-all duration-75 ease-in"
                    />
                </div>
                <div className="flex flex-col">
                    <h1 className="text-base md:text-lg lg:text-xl font-bold text-slate-100">
                        {title}
                    </h1>
                    <div className="flex gap-2 my-2 items-center font-bold text-sm text-slate-100">
                        <span className="flex gap-1 items-center">
                            <Star fill="currentColor" size={14} />
                            {data.vote_average.toFixed(1)}
                        </span>
                        <span>{dateFormatted}</span>
                        <div className="flex flex-wrap gap-2">
                            {data.genres.map((genre: Genre) => (
                                <Link
                                    href={`/genre/${genre.id}-${genre.name.toLowerCase().replace(/ /g, "-")}/${mediaType ?? "movie"
                                        }`}
                                    className="font-bold md:text-base text-slate-400 hover:text-slate-100"
                                    key={genre.id}
                                >
                                    {genre.name}
                                </Link>
                            ))}
                        </div>
                    </div>
                    {data.tagline && (
                        <h2 className="text-slate-300 italic text-base md:text-lg lg:text-xl mt-2">
                            {data.tagline}
                        </h2>
                    )}
                    <p className="text-slate-100 mt-2">{data.overview}</p>
                </div>
            </div>
        </section>
    );
};

export default DetailHeaderInfo;
