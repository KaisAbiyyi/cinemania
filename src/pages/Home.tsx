import HeroSegment from '@/components/home/Hero';
import PopularList from '@/components/home/PopularList';
import TrendingList from '@/components/home/TrendingList';
import { Helmet } from 'react-helmet';

const HomePage = () => {
    return (<>
        <Helmet>
            <title>Cinemania</title>
        </Helmet>
        <div className="flex flex-col w-full gap-16">
            <HeroSegment />
            <TrendingList />
            <PopularList />
        </div>
    </>
    );
}

export default HomePage;