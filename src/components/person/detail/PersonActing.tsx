import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getYear } from "date-fns";
import { FC, HTMLAttributes } from "react";
import { Link } from "react-router-dom";

interface PersonActingProps extends HTMLAttributes<HTMLDivElement> {
    data: any;
    className?: string
}

const PersonActing: FC<PersonActingProps> = ({ data, className }) => {
    const KnownForMovies = data.cast.sort((a: any, b: any) => b.vote_average - a.vote_average).filter((item: any) => !item.character.includes("Self")).slice(0, 10)
    const Movie = data.cast.sort((a: any, b: any) => {
        const dateA = new Date(a.release_date || a.first_air_date)
        const dateB = new Date(b.release_date || b.first_air_date)

        return dateB.getTime() - dateA.getTime()
    }).map((item: any) => {
        let overview = item.overview.split(" ")
        if (overview.length > 20) {
            return ({
                ...item,
                overview: overview.slice(0, 20).join(" ") + "..."
            })
        } else {
            return ({
                ...item
            })
        }
    })
    const imagePath = import.meta.env.VITE_TMDB_POSTER_URL

    return (
        <Card className={cn("border-0", className)}>
            <CardContent className="flex flex-col gap-4 p-0">
                <CardTitle className="text-lg">Known For</CardTitle>
                <div className="flex items-start gap-8 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                    {KnownForMovies.map((item: any) => (
                        <Card key={item.id} className="relative flex flex-col gap-4 bg-transparent border-none">
                            <CardHeader className="p-0 w-36">
                                <Link to={`/movie/${item.id}-${((item.title || item.original_title || item.name) as string).toLowerCase().replace(/ /g, "-").replace(":", "")}`}>
                                    <img src={`${import.meta.env.VITE_TMDB_POSTER_URL}/w500${item.poster_path}`} className="rounded-sm" alt={item.name} />
                                </Link>
                            </CardHeader>
                            <CardContent>
                                <CardTitle className="text-sm text-center">{item.title || item.original_title || item.name}</CardTitle>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </CardContent>
            <CardContent className="flex flex-col gap-4 p-0">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Acting</CardTitle>
                    <div className="flex gap-2">
                        <Select>
                            <SelectTrigger>
                                <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent align="end">
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="movies">Movies</SelectItem>
                                <SelectItem value="tv">TV Shows</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select>
                            <SelectTrigger>
                                <SelectValue placeholder="Department" />
                            </SelectTrigger>
                            <SelectContent align="end">
                                <SelectItem value="acting">Acting</SelectItem>
                                <SelectItem value="production">Production</SelectItem>
                                <SelectItem value="crew">Crew</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <CardContent className="flex flex-col gap-4 p-0">
                    {Movie.map((item: any) => (
                        <HoverCard key={item.id}>
                            <HoverCardTrigger asChild>
                                <Link to={`/movie/${item.id}-${((item.title || item.original_title || item.name) as string).toLowerCase().replace(/ /g, "-").replace(":", "")}`}>
                                    <Card className="flex flex-row items-center gap-4 p-4 bg-secondary/50">
                                        <CardHeader className="w-10 p-0 text-center">
                                            <CardDescription className="text-lg">{item.release_date || item.first_air_date ? getYear(new Date(item.release_date || item.first_air_date)) : "-"}</CardDescription>
                                        </CardHeader>
                                        <CardContent className="p-0">
                                            <CardTitle className="text-lg">{item.title ?? item.name ?? item.original_title}</CardTitle>
                                            <CardDescription>As {item.character}</CardDescription>
                                        </CardContent>
                                    </Card>
                                </Link>
                            </HoverCardTrigger>
                            <HoverCardContent align="start" className="relative p-0 overflow-hidden w-96">
                                <img src={`${imagePath}/w500${item.backdrop_path}`} alt="" />
                                <div className={item.backdrop_path ? "absolute inset-0 flex flex-col justify-end w-full h-full gap-4 p-4 bg-gradient-to-b from-primary/50 via-background/70 to-background" : "flex flex-col gap-4 p-4"}>
                                    <Link to={`/movie/${item.id}-${((item.title || item.original_title || item.name) as string).toLowerCase().replace(/ /g, "-").replace(":", "")}`}>
                                        <CardTitle className="text-lg duration-100 ease-in hover:opacity-80">{item.title || item.original_title || item.name}</CardTitle>
                                    </Link>
                                    <CardDescription>{item.overview.trim() === "" ? "We don't have an overview translated in English. Help us expand our database by adding one." : item.overview}</CardDescription>
                                </div>
                            </HoverCardContent>
                        </HoverCard>
                    ))}
                </CardContent>
            </CardContent>
        </Card>
    );
}

export default PersonActing;