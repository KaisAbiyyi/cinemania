import HeroSection from '@/pages/home/components/hero/HeroSection';
import { FC } from 'react';
import { Helmet } from 'react-helmet-async';
import GenreList from './components/genre/GenreList';
import PopularMovieList from './components/PopularMovieList';
import PopularTVList from './components/PopularTVList';

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
        </>
    );
};

export default HomePage;
