import { FC } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Skeleton } from "../ui/skeleton";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, User } from "lucide-react";

interface TopBilledCastProps {
    detailType: string;
    id: number
}

const TopBilledCast: FC<TopBilledCastProps> = ({ detailType, id }) => {
    const token = import.meta.env.VITE_TMDB_API_RAT
    const { pathname } = useLocation()

    const { data: Credit, isPending: CreditPending } = useQuery({
        queryKey: [`Credit${id}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${id}/credits`, { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    if (CreditPending) return (
        <div className="z-20 flex flex-col gap-8 p-4 mx-16 -mt-16 rounded-lg bg-background">
            <CardTitle className="text-lg">Top Billed Cast</CardTitle>
            <div className="flex gap-4">
                <Skeleton className="w-52 h-96" />
                <Skeleton className="w-52 h-96" />
                <Skeleton className="w-52 h-96" />
            </div>
        </div>
    )

    return (
        <Card className="flex flex-col gap-8 p-8 border-none bg-background rounded-3xl">
            <CardHeader className="flex flex-row items-center justify-between p-0">
                <CardTitle className="text-lg">Top Billed Cast</CardTitle>
                <Link to={`${pathname}/cast`} className="p-2 px-4 text-base font-semibold duration-200 ease-out rounded-full hover:text-primary-foreground hover:bg-primary">View full cast and crew</Link>
            </CardHeader>
            <CardContent className="flex gap-8 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                {Credit?.cast.slice(0, 10).map((item: any) => (
                    <Link
                        to={`/person/${item.id}-${(item.name as string).toLowerCase().replace(/ /g, "-")}`}
                        className="relative overflow-hidden rounded-t-lg group h-60 min-w-44"
                        key={item.id}>
                        {item.profile_path ?
                            <img src={`${import.meta.env.VITE_TMDB_POSTER_URL}/w500/${item.profile_path}`} className="object-cover w-full h-full" />
                            :
                            <div className="flex w-full h-full text-background bg-primary items-center-justify-center">
                                <User className="w-full h-full" />
                            </div>
                        }
                        <div className="absolute inset-0 flex flex-col items-center justify-end min-w-full min-h-full duration-200 ease-out bg-gradient-to-b from-transparent via-background/70 to-background hover:from-transparent group-hover:opacity-75">
                        </div>
                        <div className="absolute inset-0 flex flex-col items-center justify-end min-w-full min-h-full">
                            <CardTitle className="text-base text-center">{item.name}</CardTitle>
                            <CardDescription className="text-sm text-center">{item.character}</CardDescription>
                        </div>
                    </Link>
                ))}
                {Credit.cast.length > 10 &&
                    <Link to={`${pathname}/cast`} className="flex items-center justify-center p-4 duration-200 ease-out rounded-lg hover:bg-primary/90 bg-primary text-primary-foregound">
                        <span className="m-0 text-lg font-bold">More</span>
                        <ChevronRight />
                    </Link>
                }
            </CardContent>
        </Card>
    );
}

export default TopBilledCast;