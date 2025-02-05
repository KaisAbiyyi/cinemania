import { FC } from 'react';
import { Link } from 'react-router-dom';

const HomePage: FC = () => {
    // Data statis untuk contoh tampilan awal
    const popularMovies = [
        { id: 1, title: 'Movie 1', release_date: '2025-01-01', poster_path: '/placeholder1.jpg' },
        { id: 2, title: 'Movie 2', release_date: '2025-02-01', poster_path: '/placeholder2.jpg' },
        { id: 3, title: 'Movie 3', release_date: '2025-03-01', poster_path: '/placeholder3.jpg' },
    ];

    const nowPlayingMovies = [
        { id: 4, title: 'Now Playing 1', release_date: '2025-04-01', poster_path: '/placeholder4.jpg' },
        { id: 5, title: 'Now Playing 2', release_date: '2025-05-01', poster_path: '/placeholder5.jpg' },
        { id: 6, title: 'Now Playing 3', release_date: '2025-06-01', poster_path: '/placeholder6.jpg' },
    ];

    return (
        <div className="space-y-8">
            {/* Section: Popular Movies */}
            <section>
                <h2 className="text-2xl font-bold mb-4">Popular Movies</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {popularMovies.map((movie) => (
                        <Link to={`/movie/${movie.id}`} key={movie.id}>
                            <div className="bg-white rounded shadow-md overflow-hidden">
                                <img
                                    src={`https://via.placeholder.com/300x450?text=${movie.title}`}
                                    alt={movie.title}
                                    className="w-full h-64 object-cover"
                                />
                                <div className="p-2">
                                    <h3 className="text-lg font-semibold truncate">{movie.title}</h3>
                                    <p className="text-sm text-gray-600">{movie.release_date}</p>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            </section>

            {/* Section: Now Playing */}
            <section>
                <h2 className="text-2xl font-bold mb-4">Now Playing</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {nowPlayingMovies.map((movie) => (
                        <Link to={`/movie/${movie.id}`} key={movie.id}>
                            <div className="bg-white rounded shadow-md overflow-hidden">
                                <img
                                    src={`https://via.placeholder.com/300x450?text=${movie.title}`}
                                    alt={movie.title}
                                    className="w-full h-64 object-cover"
                                />
                                <div className="p-2">
                                    <h3 className="text-lg font-semibold truncate">{movie.title}</h3>
                                    <p className="text-sm text-gray-600">{movie.release_date}</p>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
};

export default HomePage;
