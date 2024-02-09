import TrendingList from '@/components/home/TrendingList';
import { Helmet } from 'react-helmet';

const HomePage = () => {
    return (<>
        <Helmet>
            <title>Cinemania</title>
        </Helmet>
        <div className="flex flex-col w-full">
            <TrendingList />
        </div>
    </>
    );
}

export default HomePage;