import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Plus, Star } from "lucide-react";
import { FC } from "react";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

interface SlideInfoProps {
    id: number;
    detailType: string;
}



const SlideInfo: FC<SlideInfoProps> = ({ id, detailType }) => {
    const token = import.meta.env.VITE_TMDB_API_RAT;
    const { data: Info, isPending: InfoPending } = useQuery({
        queryKey: [`get${detailType}Detail${id}Info`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return data;
        },
    });

    if (InfoPending) {
        return (
            <div className="flex flex-col justify-end gap-6">
                <Skeleton className="h-16 w-96" />
                <div className="flex flex-col gap-2 lg:items-center lg:flex-row">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="w-8 h-8" />
                            <Skeleton className="w-8 h-8" />
                        </div>
                        <Skeleton className="w-24 h-8" />
                        {detailType === "movie" && <Skeleton className="w-16 h-8" />}
                    </div>
                    <div className="flex items-center gap-2">
                        <Skeleton className="w-16 h-8" />
                        <Skeleton className="w-16 h-8" />
                        <Skeleton className="w-16 h-8" />
                    </div>
                </div>
                <div className="flex gap-4">
                    <Button className="rounded-full" disabled>View Details</Button>
                    <Button variant="secondary" className="rounded-full" disabled>Add to list</Button>
                </div>
                <Skeleton className="w-64 h-8" />
            </div>
        );
    }

    return (
        <div className="flex flex-col justify-end gap-6">
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-thin lg:text-lg text-secondary-foreground/50">DAILY TRENDING</h3>
                <h1 className="flex gap-2 text-2xl font-bold lg:text-5xl text-primary-foreground">
                    {Info.title ?? Info.original_title ?? Info.name}
                </h1>
            </div>
            <div className="flex gap-4 lg:items-center">
                <div className="flex items-center gap-4">
                    <span className="flex items-center gap-2 text-sm font-bold rounded-sm ">
                        <Star fill="currentColor" size={14} />
                        {Info.vote_average.toFixed(1)}
                    </span>
                </div>
                <div className="flex gap-2">
                    {Info.genres.map((item: any) => (
                        <>
                            <Link
                                to={`/genre/${item.id}-${(item.name as string).toLowerCase().replace(/ /g, "-")}/${detailType}`}
                                className="text-secondary-foreground/50  font-bold hover:text-secondary-foreground/90"
                                key={item.id}
                            >
                                {item.name}
                            </Link>
                        </>
                    ))}
                </div>
            </div>
            <div className="flex gap-4">
                <Link to={`/${Info.media_type ?? detailType}/${Info.id}-${((Info.title || Info.original_title || Info.name) as string).toLowerCase().replace(/ /g, "-").replace(":", "")}`} className={buttonVariants({ className: "shadow-lg !rounded-full" })}>View Details</Link>
                <Button variant="secondary" className="rounded-full"><Plus /></Button>
            </div>
        </div>
    );
}

export default SlideInfo;