import ContentAside from "@/components/detail/ContentAside";
import DetailHeroSegment from "@/components/detail/Hero";
import MediaContent from "@/components/detail/MediaContent";
import ReviewOverview from "@/components/detail/ReviewOverview";
import HeroSkeleton from "@/components/detail/Skeletons/HeroSkeleton";
import MediaSkeleton from "@/components/detail/Skeletons/MediaSkeleton";
import ReviewSkeleton from "@/components/detail/Skeletons/ReviewSkeleton";
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
    const { data: Reviews, isPending: ReviewPending } = useQuery({
        queryKey: [`reviewOverview${id}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${id}/reviews?language=en-US&page=1`, { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    const { data: Images, isPending: ImagesPending } = useQuery({
        queryKey: [`images${id}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/movie/${id}/images`, { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    // const { data: Videos, isPending: VideosPending } = useQuery({
    //     queryKey: [`videos${id}`],
    //     queryFn: async () => {
    //         const { data } = await axios.get(`https://api.themoviedb.org/3/movie/${id}/videos?language=en-US`, { headers: { Authorization: `Bearer ${token}` } })
    //         return data
    //     }
    // })

    

    // console.log(Videos)

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
                <title>{Detail.name || Detail.original_title || Detail.title} ({(getYear(Detail.release_date ?? Detail.first_air_date)).toString()}) | Cinemania</title>
            </Helmet>
            <div className="flex flex-col">
                <DetailHeroSegment detailType={detailType} detail={Detail} />
                <div className="flex flex-col pb-8 mx-2 lg:mx-16 lg:flex-row xl:-mt-20">
                    <div className="z-20 flex flex-col w-full gap-16 lg:w-4/5">
                        <TopBilledCast detailType={detailType} id={Detail?.id} />
                        {ReviewPending ?
                            <ReviewSkeleton />
                            :
                            <ReviewOverview reviews={Reviews} title={Detail.title || Detail.original_title || Detail.name} />
                        }
                        {ImagesPending ?
                            <MediaSkeleton />
                            :
                            <MediaContent posters={Images.posters} backdrops={Images.backdrops} />
                        }
                    </div>
                    <ContentAside detailType={detailType} Detail={Detail} />
                </div>
            </div>
        </>
    );
}

export default ContentDetail;