import TrendingSliderSkeleton from '@/components/Trending/Skeletons/TrendingSliderSkeleton';
import TrendingSlider from '@/components/Trending/TrendingSlider';
import GenreList from '@/components/home/GenreList';
import PopularList from '@/components/home/PopularList';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Helmet } from 'react-helmet';

const HomePage = () => {
    const token = import.meta.env.VITE_TMDB_API_RAT

    const { data: MovieGenre, isPending: MovieGenrePending } = useQuery({
        queryKey: ['geMovieGenre'],
        queryFn: async () => {
            const { data } = await axios.get("https://api.themoviedb.org/3/genre/movie/list", { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    const { data: Trending, isPending: TrendingPending } = useQuery({
        queryKey: ["getTrendingHomepage"],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/trending/all/day`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return data;
        }
    });
    const { data: TVGenre, isPending: TVGenrePending } = useQuery({
        queryKey: ['geTVGenre'],
        queryFn: async () => {
            const { data } = await axios.get("https://api.themoviedb.org/3/genre/tv/list", { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    return (<>
        <Helmet>
            <title>Cinemania</title>
        </Helmet>
        <div className="flex flex-col w-full gap-8">
            {/* <HeroSegment /> */}
            {!MovieGenrePending && !TVGenrePending &&
                <>
                    {TrendingPending ? <TrendingSliderSkeleton /> :
                        <TrendingSlider data={Trending} />
                    }
                    {/* <TrendingList MovieGenre={MovieGenre.genres} TVGenre={TVGenre.genres} /> */}
                    <PopularList MovieGenre={MovieGenre.genres} TVGenre={TVGenre.genres} />
                    <GenreList data={{ TVGenre, MovieGenre }} />
                </>
            }
        </div>
    </>
    );
}

export default HomePage;