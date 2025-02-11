import HeroSection from '@/pages/home/components/hero/HeroSection';
import { FC } from 'react';
import { Helmet } from 'react-helmet-async';
import GenreList from './components/genre/GenreList';

const HomePage: FC = () => {
    // Data statis untuk contoh tampilan awal

    return (
        <>
            <Helmet>
                <title>Cinemania</title>
            </Helmet>
            <HeroSection />
            <GenreList />
        </>
    );
};

export default HomePage;
