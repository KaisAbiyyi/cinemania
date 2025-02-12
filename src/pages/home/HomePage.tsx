import HeroSection from '@/pages/home/components/hero/HeroSection';
import { FC } from 'react';
import { Helmet } from 'react-helmet-async';
import GenreList from './components/genre/GenreList';
import PopularMovieList from './components/PopularMovieList';
import PopularTVList from './components/PopularTVList';
import TopRatedMovieList from './components/TopRatedMovieList';
import NowPlayingMovie from './components/NowPlayingMovie';
import UpcomingMovie from './components/UpcomingMovie';

const HomePage: FC = () => {
    return (
        <>
            <Helmet>
                <title>Cinemania</title>
            </Helmet>
            <HeroSection />
            <GenreList />
            <PopularMovieList />
            <PopularTVList />
            <div className="flex flex-col gap-10 lg:flex-row">
                <NowPlayingMovie />
                <UpcomingMovie />
            </div>
            <TopRatedMovieList />
        </>
    );
};

export default HomePage;
