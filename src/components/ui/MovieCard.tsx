import { format, parseISO } from "date-fns";
import { Plus, Star } from "lucide-react";
import { FC } from "react";
import { Link } from "react-router-dom";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

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

// @ts-ignore
const MovieCard: FC<MovieCardProps> = ({ item, mediaType, MovieGenre, TVGenre, isGrid }) => {
    // let genre;
    // if (!!MovieGenre || !!TVGenre) {
    //     if (!!item.genre_ids) {
    //         if (mediaType === "movie") {
    //             genre = MovieGenre.filter((genre: any) => item.genre_ids.includes(genre.id)) ?? [];
    //         } else {
    //             genre = TVGenre.filter((genre: any) => item.genre_ids.includes(genre.id)) ?? [];
    //         }
    //     } else {
    //         genre = [];
    //     }
    // }
    const releaseDate = item.release_date || item.first_air_date;
    const formattedDate = formatDate(releaseDate);

    return (
        <div>
            <Card key={item.id} className="relative flex flex-col gap-4 overflow-hidden bg-transparent border-none">
                <div className="absolute flex items-center gap-1 px-2 py-1 text-xs font-extrabold rounded-full text-primary-foreground bg-background top-4 left-4">
                    <span className="text-yellow-500">
                        <Star fill="currentColor" size={12} />
                    </span>
                    {item.vote_average ? (item.vote_average as number).toFixed(1) : "NR"}
                </div>
                <Button title="Add to Watchlist" variant={"ghost"} className="absolute top-0 right-0 z-10 w-8 h-8 p-0 rounded-none rounded-tr-lg rounded-bl-sm bg-secondary/60" size={"icon"}><Plus size={18} /></Button>
                <CardHeader className={isGrid ? "w-full p-0 h-80 lg:h-96" : "w-56 p-0 h-80 lg:w-64 lg:h-96"}>
                    <img
                        src={item.poster_path ? `${import.meta.env.VITE_TMDB_POSTER_URL}/w500${item.poster_path}` : "/images/blankimage.png"}
                        className={`${!item.poster_path && "opacity-25"} object-cover h-full rounded-lg`}
                        alt={item.title || item.name}
                        onError={(e) => { e.currentTarget.src = "/images/blankimage.png"; e.currentTarget.classList.add("opacity-25"); }}
                    />
                </CardHeader>
                <CardContent className={`absolute bottom-0 w-full py-6 px-2 lg:px-4 bg-gradient-to-b from-transparent via-background/80 to-background`}>
                    <CardTitle className="text-base md:text-lg">{item.title || item.original_title || item.name}</CardTitle>
                    <CardDescription className="text-xs md:text-sm">{formattedDate}</CardDescription>
                    {/* <div className="flex flex-wrap gap-2 mt-2">
                        {genre && genre.map((genre: any) => (
                            <Link
                                title={genre.name}
                                to={`/genre/${genre.id}-${(genre.name as string).toLowerCase().replace(/ /g, "-")}/${mediaType}`}
                                className="px-2 py-1 text-xs font-bold duration-200 ease-out rounded-full bg-secondary/80 hover:bg-primary"
                                key={genre.id}>
                                {genre.name}
                            </Link>
                        ))}
                    </div> */}
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
