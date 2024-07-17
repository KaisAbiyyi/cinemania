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
import NotFound404 from "./NotFound404";

const ContentDetail = () => {
    const { id } = useParams();
    const { pathname } = useLocation();
    const detailType = pathname.split("/").slice(1)[0] ?? "movie";
    const splittedId = (id as string).split("-")[0];
    const token = import.meta.env.VITE_TMDB_API_RAT;

    const { data: Detail, isPending: DetailPending, error: DetailError } = useQuery({
        queryKey: [`get${detailType}Detail${splittedId}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${splittedId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return data;
        },
        enabled: !!splittedId, // Only run query if splittedId exists
    });

    const { data: Reviews, isPending: ReviewPending, error: ReviewError } = useQuery({
        queryKey: [`reviewOverview${id}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${id}/reviews?language=en-US&page=1`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return data;
        },
        enabled: !!id, // Only run query if id exists
    });

    const { data: Images, isPending: ImagesPending, error: ImagesError } = useQuery({
        queryKey: [`images${id}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${id}/images`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return data;
        },
        enabled: !!id, // Only run query if id exists
    });

    if (DetailPending) {
        return (
            <div className="flex flex-col">
                <HeroSkeleton />
            </div>
        );
    }

    if (DetailError) {
        return <NotFound404 />;
    }

    return (
        <>
            <Helmet>
                <title>
                    {Detail?.title || Detail?.original_title || Detail?.name} (
                    {getYear(Detail?.release_date ?? Detail?.first_air_date).toString()}) | Cinemania
                </title>
            </Helmet>
            <div className="flex flex-col">
                <DetailHeroSegment originCountry={Detail?.origin_country?.[0]} detailType={detailType} detail={Detail} />
                <div className="flex flex-col pb-8 mx-2 lg:mx-8 lg:flex-row">
                    <div className="flex flex-col w-full gap-8 lg:w-4/5">
                        <TopBilledCast detailType={detailType} id={Detail?.id} />
                        {ReviewPending ? <ReviewSkeleton /> : ReviewError ? <div>Error loading reviews.</div> : <ReviewOverview reviews={Reviews} title={Detail?.title || Detail?.original_title || Detail?.name} />}
                        {ImagesPending ? <MediaSkeleton /> : ImagesError ? <div>Error loading images.</div> : <MediaContent posters={Images?.posters} backdrops={Images?.backdrops} />}
                    </div>
                    <ContentAside detailType={detailType} Detail={Detail} />
                </div>
            </div>
        </>
    );
};

export default ContentDetail;
