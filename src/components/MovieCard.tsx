import { formatDate } from "@/utils/dateUtils";
import { Star } from "lucide-react";
import { FC } from "react";
import { Badge } from "./ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface MovieCardProps {
    id: number
    title: string
    posterPath: string
    rating: number
    releaseDate: string
    type: 'movie' | 'tv'
    className?: string
}

const MovieCard: FC<MovieCardProps> = ({ id, title, posterPath, releaseDate, rating, type, className }) => {
    const posterBaseUrl = import.meta.env.VITE_TMDB_POSTER_URL

    return (
        <Card className={cn("relative overflow-hidden transition-all duration-75 ease-in min-w-48 hover:shadow-primary hover:shadow-md hover:border-primary h-72 md:h-80 md:min-w-56", className)}>
            <img src={`${posterBaseUrl}/w500/${posterPath}`} alt={title} className="object-cover w-full h-full" />
            <div className="absolute inset-0 flex flex-col justify-between via-transparent bg-gradient-to-t from-slate-950 to-transparent">
                <CardHeader className="flex flex-row items-center justify-between p-3">
                    <Badge variant="secondary" className="flex gap-2 text-yellow-500">
                        <Star size={10} fill="currentColor" />
                        <span className="font-bold text-slate-950 dark:text-slate-50">{rating.toFixed(1)}</span>
                    </Badge>
                </CardHeader>
                <CardHeader className="p-3">
                    <CardTitle className="text-lg text-slate-50">{title}</CardTitle>
                    <CardDescription className="text-sm text-slate-400">
                        {formatDate(releaseDate)}
                    </CardDescription>
                </CardHeader>
            </div>
            <Link to={`/${type}/${id}-${(title as string).toLowerCase().replace(/ /g, "-").replace(":", "")}`} className="absolute inset-0" />
        </Card>
    );
}

export default MovieCard;