import { format, parseISO } from "date-fns";
import { FC } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { Link } from "react-router-dom";

interface MovieCardProps {
    item: any
    mediaType?: string
    TVGenre?: any
    MovieGenre?: any
    isGrid?: boolean
}
const formatDate = (dateString?: string): string => {
    if (!dateString) return 'Unknown Date';
    try {
        const date = parseISO(dateString);
        return !isNaN(date.getTime()) ? format(date, "MMM dd, yyyy") : 'Unknown Date';
    } catch {
        return 'Unknown Date';
    }
};

const MovieCard: FC<MovieCardProps> = ({ item, mediaType, MovieGenre, TVGenre, isGrid }) => {
    // console.log(TVGenre)
    let genre
    if (!!MovieGenre || !!TVGenre) {
        if (mediaType === "movie") {
            genre = MovieGenre.filter((genre: any) => item.genre_ids.includes(genre.id))
        } else {
            genre = TVGenre.filter((genre: any) => item.genre_ids.includes(genre.id))
        }
    }
    const releaseDate = item.release_date || item.first_air_date;
    const formattedDate = formatDate(releaseDate);

    return (
        <div>
            <Card key={item.id} className="relative flex flex-col gap-4 overflow-hidden bg-transparent border-none">
                <div className="absolute top-0 right-0 p-2 text-xs font-extrabold text-black bg-orange-600 rounded-bl-lg">
                    {(item.vote_average as number).toFixed(1)}
                </div>
                <CardHeader className={isGrid ? "w-full p-0 h-80 lg:h-96" : "w-56 p-0 h-80 lg:w-64 lg:h-96"}>
                    <img src={`${import.meta.env.VITE_TMDB_POSTER_URL}/w500${item.poster_path}`} className="object-cover rounded-lg" alt={item.name} />
                </CardHeader>
                <CardContent className={`absolute bottom-0 w-full py-6 bg-gradient-to-b from-transparent via-bfackground/80 to-background`}>
                    <CardTitle className="text-lg">{item.title || item.original_title || item.name}</CardTitle>
                    <CardDescription>{formattedDate}</CardDescription>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {genre.map((genre: any) => (
                            <Link
                                title={genre.name}
                                to={`/genre/${genre.id}-${(genre.name as string).toLowerCase().replace(/ /g, "-")}/${mediaType}`}
                                className="px-2 py-1 text-xs font-bold duration-200 ease-out rounded-full bg-secondary/80 hover:bg-primary"
                                key={genre.id}>
                                {genre.name}
                            </Link>
                        ))}
                    </div>
                </CardContent>
                <Link
                    to={`/${item.media_type ?? mediaType}/${item.id}-${((item.title || item.original_title || item.name) as string).toLowerCase().replace(/ /g, "-").replace(":", "")}`}
                    title={item.title || item.original_title || item.name}
                    className="absolute inset-0"
                />
            </Card>
        </div>
    );
}

export default MovieCard;