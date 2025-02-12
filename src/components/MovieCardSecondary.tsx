import { FC } from "react"
import { Card, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { useGenres } from "@/pages/home/hooks/useGenres"
import { Genre } from "@/types/genre"
import { Link } from "react-router-dom"
import { Badge } from "./ui/badge"

interface MovieCardSecondaryProps {
    id: number
    title: string
    posterPath: string
    rating: number
    releaseDate: string
    type: 'movie' | 'tv'
    description: string
    genre_ids: number[]
}

const MovieCardSecondary: FC<MovieCardSecondaryProps> = ({ id, title, posterPath, rating, releaseDate, type, description, genre_ids }) => {
    const posterBaseUrl = import.meta.env.VITE_TMDB_POSTER_URL
    const { data, isPending } = useGenres(type)

    if (isPending) return "genre pending"

    // Filter genres berdasarkan genre_ids yang ada di props
    const genres = data?.filter((genre: Genre) => genre_ids.includes(genre.id)) || []

    return (
        <Card className="relative flex flex-row overflow-hidden transition-all duration-75 ease-in hover:border-primary hover:shadow-sm hover:shadow-primary">
            <Badge className="absolute top-2 right-2">
                {rating.toFixed(1)}
            </Badge>
            <img src={`${posterBaseUrl}/w500/${posterPath}`} alt={title} className="object-cover w-36 md:w-40 " />
            <CardHeader className="flex-grow gap-2 bg-gradient-to-bl via-transparent from-secondary to-transparent">
                <div className="flex flex-col gap-2">
                    <CardTitle className="text-lg">{title}</CardTitle>
                    <CardDescription className="text-xs">{releaseDate}</CardDescription>
                </div>
                <div className="z-10 flex gap-2">
                    {/* Menampilkan genres yang sudah difilter */}
                    {genres.map((genre: Genre) => (
                        <Link
                            to={`/genre/${genre.id}-${genre.name.toLowerCase().replace(/ /g, "-")}/${type ?? "movie"}`}
                            className="text-sm font-bold text-slate-500 hover:text-slate-100"
                            key={genre.id}
                        >
                            {genre.name}
                        </Link>
                    ))}
                </div>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <Link to={`/${type}/${id}-${(title as string).toLowerCase().replace(/ /g, "-").replace(":", "")}`} className="absolute inset-0" />
        </Card>
    );
}

export default MovieCardSecondary;
