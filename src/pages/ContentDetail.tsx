import DetailHeroSegment from "@/components/detail/Hero";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
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
        return "loading"
    }

    return (
        <DetailHeroSegment detailType={detailType} data={Detail} />
    );
}

export default ContentDetail;