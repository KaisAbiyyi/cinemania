import ContentAside from "@/components/detail/ContentAside";
import DetailHeroSegment from "@/components/detail/Hero";
import HeroSkeleton from "@/components/detail/Skeletons/HeroSkeleton";
import TopBilledCast from "@/components/detail/TopBilledCast";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { getYear } from "date-fns";
import { Helmet } from "react-helmet";
import { useLocation, useParams } from "react-router-dom";


const ContentDetail = () => {
    const { id } = useParams()
    const { pathname } = useLocation()
    const detailType = pathname.split("/").slice(1)[0] ?? "movie"
    const splittedId = ((id as string).split("-"))[0]
    const token = import.meta.env.VITE_TMDB_API_RAT

    const { data: Detail, isPending: DetailPending } = useQuery({
        queryKey: [`getDetail${detailType}${splittedId}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${splittedId}`, { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    if (DetailPending) {
        return (
            <div className="flex flex-col">
                <HeroSkeleton />
            </div>
        )
    }

    return (
        <>
            <Helmet>
                <title>{Detail.name || Detail.original_title} ({(getYear(Detail.release_date ?? Detail.first_air_date)).toString()}) | Cinemania</title>
            </Helmet>
            <div className="flex flex-col">
                <DetailHeroSegment detailType={detailType} Detail={Detail} />
                <div className="flex mx-16 -mt-20">
                    <div className="z-20 flex flex-col w-4/5 gap-8 p-8 bg-background rounded-3xl">
                        <TopBilledCast detailType={detailType} id={Detail?.id} />
                    </div>
                    <ContentAside detailType={detailType} Detail={Detail} />
                </div>
            </div>
        </>
    );
}

export default ContentDetail;