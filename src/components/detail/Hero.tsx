import { formatDurationFromMinutes } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { format, getYear } from "date-fns";
import { FC } from "react";
import { Link } from "react-router-dom";

interface DetailHeroSegmentProps {
    detail: any,
    detailType: string,
    productionCountry: string
}

const DetailHeroSegment: FC<DetailHeroSegmentProps> = ({ detail, detailType, productionCountry }) => {
    const token = import.meta.env.VITE_TMDB_API_RAT
    const { data: ReleaseDates, isPending: ReleaseDatesPending } = useQuery({
        queryKey: [`ReleaseDates${detail.id}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${detail.id}/${detailType === "tv" ? "content_ratings" : "release_dates"}`, { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })


    let certification: string = ""
    if (!ReleaseDatesPending) {
        if (detailType === "movie") {
            certification = !!ReleaseDates.results.find((item: any) => item.iso_3166_1 === productionCountry) ? ReleaseDates.results.find((item: any) => item.iso_3166_1 === productionCountry).release_dates.find((item: any) => item.certification !== '').certification : ReleaseDates.results[0].release_dates[0].certification
        } else {
            certification = !!ReleaseDates.results.find((item: any) => item.iso_3166_1 === productionCountry) ? ReleaseDates.results.find((item: any) => item.iso_3166_1 === productionCountry).rating : ReleaseDates.results[0].rating
        }
    } else {
        certification = ""
    }

    const imagePath = import.meta.env.VITE_TMDB_POSTER_URL

    return (
        <div className="relative flex flex-col min-h-screen">
            <div className="relative w-full h-full lg:hidden">
                <img src={`${imagePath}/original/${detail.backdrop_path}`} className="relative inset-0 z-0 object-cover w-full h-full" />
                <div className="flex gap-8 lg:items-center absolute bg-gradient-to-b from-primary via-primary/40 to-background w-full lg:h-full inset-0 p-4 lg:p-16 !z-20"></div>
            </div>
            <img src={`${imagePath}/original/${detail.backdrop_path}`} className="relative inset-0 z-0 hidden object-cover w-full h-full lg:block lg:opacity-20" />
            <div className="flex gap-8 lg:items-center relative  lg:absolute lg:bg-gradient-to-b lg:from-primary lg:via-primary/60 lg:to-transparent w-full lg:h-full inset-0 p-4 lg:p-16 !z-20">
                <img src={`${imagePath}/w500/${detail.poster_path}`} className="hidden w-64 border rounded-lg opacity-75 lg:block border-primary-foreground/40 border-opacity-5 xl:w-96 xl:h-[500px] object-cover drop-shadow-2xl" />
                <div className="flex flex-col gap-8">
                    <div className="flex flex-col gap-4">
                        <h1 className="flex gap-2 text-2xl font-bold lg:text-4xl text-primary lg:text-primary-foreground">
                            {detail.title ?? detail.original_title ?? detail.name}
                            <span className="font-normal">({getYear(detail.release_date ?? detail.first_air_date)})</span>
                        </h1>
                        <div className="flex flex-col gap-2 lg:items-center lg:flex-row">
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-1 text-xs border rounded-sm border-primary text-primary lg:border-primary-foreground lg:text-primary-foreground">{certification}</span>
                                {detailType === "movie" &&
                                    <>
                                        <time className="text-xs font-semibold lg:text-sm text-primary lg:text-primary-foreground">{format(new Date(detail.release_date), "MMM d, yyyy")}</time>
                                        <time className="text-xs font-semibold lg:text-sm text-primary lg:text-primary-foreground">{formatDurationFromMinutes(detail.runtime)}</time>
                                    </>
                                }
                            </div>
                            <div className="flex items-center gap-2">
                                {detail.genres.map((item: any) => (
                                    <Link
                                        to={`/genre/${item.id}-${(item.name as string).toLowerCase().replace(/ /g, "-")}/${detailType}`}
                                        className="px-2 py-1 text-xs font-bold duration-200 ease-out rounded-sm lg:text-primary lg:bg-primary-foreground bg-primary text-primary-foreground hover:shadow-md hover:shadow-primary-foreground"
                                        key={item.id}>
                                        {item.name}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-4">
                        <i className="text-xl italic font-thin text-background-foreground lg:text-primary-foreground">{detail.tagline}</i>
                        <div className="flex flex-col gap-2">
                            <h1 className="text-3xl font-bold text-background-foreground lg:text-primary-foreground">Overview</h1>
                            <p className="text-xl text-background-foreground lg:text-primary-foreground">{detail.overview}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default DetailHeroSegment;