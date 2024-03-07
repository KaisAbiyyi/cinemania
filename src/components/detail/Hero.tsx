import { formatDurationFromMinutes } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { format, getYear } from "date-fns";
import { FC } from "react";
import { Link } from "react-router-dom";

interface DetailHeroSegmentProps {
    detail: any,
    detailType: string
}

const DetailHeroSegment: FC<DetailHeroSegmentProps> = ({ detail, detailType }) => {
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
            certification = ReleaseDates.results.find((item: any) => item.iso_3166_1 === "US").release_dates.find((item: any) => item.certification !== '').certification ?? ReleaseDates.results[0].release_dates[0].certification
        } else {
            certification = ReleaseDates.results.find((item: any) => item.iso_3166_1 === "US").rating ?? ReleaseDates.results[0].rating
        }
    } else {
        certification = ""
    }


    const imagePath = import.meta.env.VITE_TMDB_POSTER_URL

    return (
        <div className="relative">
            <img src={`${imagePath}/original/${detail.backdrop_path}`} className="inset-0 z-0 object-cover w-full h-full opacity-50" />
            <div className="flex gap-8 items-center bg-gradient-to-b from-primary via-primary/80 to-transparent absolute w-full h-full inset-0 p-16 !z-20">
                <img src={`${imagePath}/w500/${detail.poster_path}`} className="border rounded-lg opacity-75 border-primary-foreground/40 border-opacity-5 w-96 drop-shadow-2xl" />
                <div className="flex flex-col gap-8">
                    <div className="flex flex-col gap-4">
                        <h1 className="flex gap-2 text-4xl font-bold text-primary-foreground">
                            {detail.title ?? detail.original_title ?? detail.name}
                            <span className="font-normal">({getYear(detail.release_date ?? detail.first_air_date)})</span>
                        </h1>
                        <div className="flex items-center gap-2">
                            <span className="px-2 py-1 text-xs border rounded-sm border-primary-foreground text-primary-foreground">{certification}</span>
                            {detailType === "movie" &&
                                <>
                                    <time className="text-sm font-semibold text-primary-foreground">{format(new Date(detail.release_date), "MMM d, yyyy")}</time>
                                    <time className="text-sm font-semibold text-primary-foreground">{formatDurationFromMinutes(detail.runtime)}</time>
                                </>
                            }
                            {detail.genres.map((item: any) => (
                                <Link
                                    to={`/genre/${item.id}-${(item.name as string).toLowerCase().replace(/ /g, "-")}/${detailType}`}
                                    className="px-2 py-1 text-xs font-bold duration-200 ease-out rounded-sm bg-primary-foreground text-primary hover:shadow-md hover:shadow-primary-foreground"
                                    key={item.id}>
                                    {item.name}
                                </Link>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-col gap-4">
                        <i className="text-xl italic font-thin text-primary-foreground">{detail.tagline}</i>
                        <div className="flex flex-col gap-2">
                            <h1 className="text-3xl font-bold text-primary-foreground">Overview</h1>
                            <p className="text-xl text-primary-foreground">{detail.overview}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default DetailHeroSegment;