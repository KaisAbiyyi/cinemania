import TrendingSliderSkeleton from "@/components/Trending/Skeletons/TrendingSliderSkeleton";
import TrendingSlider from "@/components/Trending/TrendingSlider";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { FC, useState } from "react";

const TrendingPage: FC = () => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    // @ts-ignore
    const [timeWindow, setTimeWindow] = useState<string>("day");

    const { data: Trending, isPending: TrendingPending } = useQuery({
        queryKey: ["getTrendingPage", timeWindow],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/trending/all/${timeWindow}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return data;
        }
    });

    if (TrendingPending) {
        return (
            <div className="flex flex-col gap-8">
                <TrendingSliderSkeleton />
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-8">
            <TrendingSlider data={Trending} />
        </div>

    );
}

export default TrendingPage;