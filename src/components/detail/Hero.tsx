import { getYear } from "date-fns";
import { FC } from "react";
import { Link } from "react-router-dom";

interface DetailHeroSegmentProps {
    data: any,
    detailType: string
}

const DetailHeroSegment: FC<DetailHeroSegmentProps> = ({ data, detailType }) => {
    console.log(data)
    const imagePath = import.meta.env.VITE_TMDB_POSTER_URL

    return (
        <div className="relative">
            <img src={`${imagePath}/original/${data.backdrop_path}`} className="w-full opacity-50 object-cover h-full z-0 inset-0" />
            <div className="flex gap-8 items-center bg-gradient-to-b from-primary via-primary/80 to-transparent absolute w-full h-full inset-0 p-16 !z-20">
                <img src={`${imagePath}/w500/${data.poster_path}`} className="w-96 rounded-lg drop-shadow-2xl" />
                <div className="flex flex-col gap-8">
                <div className="flex flex-col gap-4">
                    <h1 className="text-4xl text-primary-foreground flex gap-2 font-bold">
                        {data.name ?? data.original_title}
                        <span className="font-normal">({getYear(data.release_date ?? data.first_air_date)})</span>
                    </h1>
                    <div className="flex gap-2">
                        {data.genres.map((item: any) => (
                            <Link to={`/genre/${item.id}-${(item.name as string).toLowerCase().replace(/ /g, "-")}/${detailType}`} className="bg-secondary py-1 px-2 rounded-sm text-secondary-foreground text-xs" key={item.id}>{item.name}</Link>
                        ))}
                    </div>
                </div>
                <div className="flex flex-col gap-4">
                    <i className="italic text-xl font-thin text-primary-foreground">{data.tagline}</i>
                    <div className="flex flex-col gap-2">
                        <h1 className="text-3xl font-bold text-primary-foreground">Overview</h1>
                        <p className="text-xl text-primary-foreground">{data.overview}</p>
                    </div>
                </div>
                </div>
            </div>
        </div>
    )
}

export default DetailHeroSegment;