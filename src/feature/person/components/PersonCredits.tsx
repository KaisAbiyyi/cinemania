import MediaCastCard from '@/feature/media/components/MediaCastCard';
import { FC } from 'react';
import { PersonCombinedCredits } from '../hooks/usePersonCombinedCredits';

interface Props {
    data: PersonCombinedCredits;
}

const PersonCredits: FC<Props> = ({ data }) => {
    const cast = data.cast.sort((a, b) => {
        const dateA = new Date(a.release_date || a.first_air_date || "1900-01-01");
        const dateB = new Date(b.release_date || b.first_air_date || "1900-01-01");
        return dateB.getTime() - dateA.getTime(); // Sort descending
    });

    const crew = data.crew.sort((a, b) => {
        const dateA = new Date(a.release_date || a.first_air_date || "1900-01-01");
        const dateB = new Date(b.release_date || b.first_air_date || "1900-01-01");
        return dateB.getTime() - dateA.getTime(); // Sort descending
    });

    const upcomingCast = cast.filter(
        (item) => !item.release_date && !item.first_air_date
    );
    const previousCast = cast.filter(
        (item) => item.release_date || item.first_air_date
    );

    const crewByDepartment = crew.reduce((acc: Record<string, typeof crew>, item) => {
        const department = item.department || "Unknown Department";
        if (!acc[department]) acc[department] = [];
        acc[department].push(item);
        return acc;
    }, {});

    return (
        <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
            {/* Cast Section */}
            <h1 className='text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl'>Credits</h1>
            <div className="flex flex-col gap-1 md:gap-3 lg:gap-5">
                <h2 className='text-base font-semibold md:text-lg lg:text-xl xl:text-2xl'>Acting</h2>
                <div className="flex flex-col gap-1 md:gap-2 lg:gap-3">
                    {upcomingCast.map((item, index) => (
                        <MediaCastCard
                            key={index}
                            id={item.id}
                            title={item.title || item.name}
                            posterPath={item.poster_path || item.profile_path || ""}
                            rating={item.vote_average || 0}
                            releaseDate={item.release_date || item.first_air_date || ""}
                            mediaType={item.media_type as "movie" | "tv"}
                            description={item.overview}
                            genre_ids={item.genre_ids}
                            character={item.character}
                        />
                    ))}

                    {previousCast.map((item, index) => (
                        <MediaCastCard
                            key={index}
                            id={item.id}
                            title={item.title || item.name}
                            posterPath={item.poster_path || item.profile_path || ""}
                            rating={item.vote_average || 0}
                            releaseDate={item.release_date || item.first_air_date || ""}
                            mediaType={item.media_type as "movie" | "tv"}
                            description={item.overview}
                            genre_ids={item.genre_ids}
                            character={item.character}
                        />
                    ))}
                </div>
            </div>

            {/* Crew Section */}
            {Object.entries(crewByDepartment).map(([department, items]) => {
                const upcomingCrew = items.filter(
                    (item) => !item.release_date && !item.first_air_date
                );
                const previousCrew = items.filter(
                    (item) => item.release_date || item.first_air_date
                );

                return (
                    <div key={department} className="flex flex-col gap-1 md:gap-3 lg:gap-5">
                        <h2 className='text-base font-semibold md:text-lg lg:text-xl xl:text-2xl'>{department}</h2>
                        <div className="flex flex-col gap-1 md:gap-2 lg:gap-3">
                            {upcomingCrew.map((item, index) => (
                                <MediaCastCard
                                    key={index}
                                    id={item.id}
                                    title={item.title || item.name}
                                    posterPath={item.poster_path || item.profile_path || ""}
                                    rating={item.vote_average || 0}
                                    releaseDate={item.release_date || item.first_air_date || ""}
                                    mediaType={item.media_type as "movie" | "tv"}
                                    description={item.overview}
                                    genre_ids={item.genre_ids}
                                    character={item.job}
                                />
                            ))}

                            {previousCrew.map((item, index) => (
                                <MediaCastCard
                                    key={index}
                                    id={item.id}
                                    title={item.title || item.name}
                                    posterPath={item.poster_path || item.profile_path || ""}
                                    rating={item.vote_average || 0}
                                    releaseDate={item.release_date || item.first_air_date || ""}
                                    mediaType={item.media_type as "movie" | "tv"}
                                    description={item.overview}
                                    genre_ids={item.genre_ids}
                                    character={item.job}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default PersonCredits;