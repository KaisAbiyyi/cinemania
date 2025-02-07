import HeroSection from '@/pages/home/components/hero/HeroSection';
import { FC } from 'react';
import { Helmet } from 'react-helmet-async';

const HomePage: FC = () => {
    // Data statis untuk contoh tampilan awal

    return (
        <>
            <Helmet>
                <title>Cinemania</title>
            </Helmet>
            <HeroSection />
        </>
    );
};

export default HomePage;
