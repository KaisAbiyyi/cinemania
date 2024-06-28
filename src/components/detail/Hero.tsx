import { formatDurationFromMinutes } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { FC, useRef } from "react";
import { Link } from "react-router-dom";
import BlurImage from "../ui/BlurImage"; // Adjust the path as needed
import { buttonVariants } from "../ui/button";

interface DetailHeroSegmentProps {
    detail: any;
    detailType: string;
    originCountry: string;
}

const DetailHeroSegment: FC<DetailHeroSegmentProps> = ({ detail, detailType, originCountry }) => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const imagePath = import.meta.env.VITE_TMDB_POSTER_URL;
    const heroRef = useRef<HTMLDivElement>(null);

    const { data: ReleaseDates, isPending: ReleaseDatesPending } = useQuery({
        queryKey: [`ReleaseDates${detail.id}`],
        queryFn: async () => {
            const { data } = await axios.get(
                `https://api.themoviedb.org/3/${detailType}/${detail.id}/${detailType === "tv" ? "content_ratings" : "release_dates"}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            return data;
        },
    });

    let certification = "";
    if (!ReleaseDatesPending) {
        if (detailType === "movie") {
            const countryData = ReleaseDates.results.find((item: any) => item.iso_3166_1 === originCountry);
            certification = countryData
                ? countryData.release_dates.find((item: any) => item.certification !== '').certification
                : ReleaseDates.results[0].release_dates[0].certification;
        } else {
            const countryData = ReleaseDates.results.find((item: any) => item.iso_3166_1 === originCountry);
            certification = countryData ? countryData.rating : ReleaseDates.results[0].rating;
        }
    }


    return (
        <div ref={heroRef} className="relative flex flex-col h-[700px] overflow-hidden">
            <div className="relative w-full h-full lg:hidden">
                <BlurImage
                    src={`${imagePath}/original/${detail.backdrop_path}`}
                    className="relative inset-0 z-0 object-cover w-full h-full"
                    alt={detail.title ?? detail.original_title ?? detail.name}
                />
                <div className="flex gap-8 lg:items-center absolute bg-gradient-to-b from-primary/30 to-background w-full lg:h-full inset-0 p-4 lg:p-16 !z-20"></div>
            </div>
            <BlurImage
                src={`${imagePath}/original/${detail.backdrop_path}`}
                className="relative inset-0 z-0 hidden object-cover w-full h-full lg:block lg:opacity-50"
                alt={detail.title ?? detail.original_title ?? detail.name}
            />
            <div className="flex gap-8 lg:items-center relative lg:absolute lg:bg-gradient-to-t lg:from-background lg:to-primary/30 w-full lg:h-[700px] inset-0 p-4 lg:p-16 !z-20">
                <BlurImage
                    src={`${imagePath}/w500/${detail.poster_path}`}
                    className="hidden w-64 border rounded-lg lg:block border-primary-foreground/40 border-opacity-5 xl:w-50 xl:h-[400px] object-cover drop-shadow-2xl"
                    alt={detail.title ?? detail.original_title ?? detail.name}
                />
                <div className="flex flex-col gap-8">
                    <div className="flex flex-col gap-4">
                        <h1 className="flex gap-2 text-2xl font-bold lg:text-4xl text-primary-foreground">
                            {detail.title ?? detail.original_title ?? detail.name}
                        </h1>
                        <div className="flex flex-col gap-4 lg:items-center lg:flex-row">
                            <div className="flex items-center gap-2 lg:order-last">
                                {detail.genres.map((item: any) => (
                                    <Link
                                        to={`/genre/${item.id}-${(item.name as string).toLowerCase().replace(/ /g, "-")}/${detailType}`}
                                        className={buttonVariants({ className: "!px-4 text-sm !py-1 h-auto hover:!bg-primary", size: "sm", variant: "secondary" })}
                                        key={item.id}
                                    >
                                        {item.name}
                                    </Link>
                                ))}
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="px-2 py-1 text-sm font-bold rounded-full bg-secondary">
                                    {certification}
                                </span>
                                <span className="flex items-center gap-2 text-sm font-bold rounded-sm ">
                                    <Star fill="currentColor" size={14} />
                                    {detail.vote_average.toFixed(1)}
                                </span>
                                {detailType === "movie" && (
                                    <time className="text-sm font-bold rounded-sm ">
                                        {formatDurationFromMinutes(detail.runtime)}
                                    </time>
                                )}
                                <time className="text-sm font-bold rounded-sm ">
                                    {format(new Date(detail.release_date ?? detail.first_air_date), "MMM d, yyyy")}
                                </time>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-8">
                        <i className="text-xl italic font-thin text-background-foreground lg:text-primary-foreground">
                            {detail.tagline}
                        </i>
                        <div className="flex flex-col gap-2">
                            <p className="text-lg text-background-foreground lg:text-primary-foreground">{detail.overview}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DetailHeroSegment;
