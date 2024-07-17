import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { User } from "lucide-react";
import { FC, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import TopBilledCastSkeleton from "./Skeletons/TopBilledCastSkeleton";
import { buttonVariants } from "../ui/button";

interface TopBilledCastProps {
    detailType: string;
    id: number
}

const TopBilledCast: FC<TopBilledCastProps> = ({ detailType, id }) => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const { pathname } = useLocation();

    const { data: Credit, isPending: CreditPending } = useQuery({
        queryKey: [`Credit${id}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${id}/${detailType === "movie" ? "credits" : "aggregate_credits"}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return data;
        }
    });

    const castList = useMemo(() => Credit?.cast.slice(0, 10) ?? [], [Credit]);

    const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());

    const handleImageLoad = (id: number) => {
        setLoadedImages(prev => new Set(prev).add(id));
    };

    if (CreditPending) return (
        <TopBilledCastSkeleton pathName={pathname} />
    );

    return (
        <Card className="flex flex-col gap-8 p-0 border-none bg-background rounded-3xl">
            <CardHeader className="flex flex-row items-center justify-between p-0">
                <CardTitle>Cast</CardTitle>
                <Link to={`${pathname}/cast`} className={buttonVariants({ variant: "ghost" })}>
                    View full cast and crew
                </Link>
            </CardHeader>
            <CardContent className="relative flex flex-col p-0">
                <div className="flex w-full gap-4 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                    {castList.map((item: any) => (
                        <Link
                            to={`/person/${item.id}-${(item.name as string).toLowerCase().replace(/ /g, "-")}`}
                            className="relative h-48 overflow-hidden rounded-t-lg group lg:h-60 min-w-32 lg:min-w-44"
                            key={item.id}>
                            {item.profile_path ?
                                <img
                                    src={`${import.meta.env.VITE_TMDB_POSTER_URL}/w500/${item.profile_path}`}
                                    className={`object-cover w-full h-full ${loadedImages.has(item.id) ? 'blur-0' : 'blur-md'}`}
                                    onLoad={() => handleImageLoad(item.id)}
                                />
                                :
                                <div className="flex items-center justify-center w-full h-full text-background bg-primary">
                                    <User className="w-full h-full" />
                                </div>
                            }
                            <div className="absolute inset-0 flex flex-col items-center justify-end min-w-full min-h-full duration-200 ease-out bg-gradient-to-b from-transparent via-background/20 to-background hover:from-transparent group-hover:opacity-75"></div>
                            <div className="absolute inset-0 flex flex-col items-center justify-end min-w-full min-h-full">
                                <CardTitle className="text-base text-center">{item.name}</CardTitle>
                                <CardDescription className="text-xs text-center">{item.character}</CardDescription>
                                {detailType === "tv" &&
                                    <div className="flex flex-wrap justify-center gap-1">
                                        {item.roles.map((roles: any) => (<CardDescription className="text-xs text-center">{roles.character}</CardDescription>))}
                                    </div>
                                }
                            </div>
                        </Link>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
};

export default TopBilledCast;
