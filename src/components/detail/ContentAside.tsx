import { FC } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Skeleton } from "../ui/skeleton";
import { Link } from "react-router-dom";

interface ContentAsideProps {
    Detail: any;
    detailType: string
}

const ContentAside: FC<ContentAsideProps> = ({ detailType, Detail }) => {
    const token = import.meta.env.VITE_TMDB_API_RAT
    const { data: Keywords, isPending: KeywordsPending } = useQuery({
        queryKey: [`keywords${Detail.id}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/${detailType}/${Detail.id}/keywords`, { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })
    const imagePath = import.meta.env.VITE_TMDB_POSTER_URL
    return (
        <Card className="z-20 flex flex-col w-full gap-6 p-8 border-none lg:w-1/5 rounded-3xl bg-background h-fit">
            <CardHeader className="p-0">
                <CardTitle className="text-base">Status</CardTitle>
                <CardDescription>{Detail.status}</CardDescription>
            </CardHeader>
            <CardHeader className="p-0">
                <CardTitle className="text-base">Original Language</CardTitle>
                <CardDescription>{Detail.spoken_languages.find((item: any) => item.iso_639_1 === Detail.original_language).english_name}</CardDescription>
            </CardHeader>
            {detailType === "movie" ?
                <>
                    <CardHeader className="p-0">
                        <CardTitle className="text-base">Budget</CardTitle>
                        <CardDescription>{new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                        }).format(Detail.budget)}</CardDescription>
                    </CardHeader>
                    <CardHeader className="p-0">
                        <CardTitle className="text-base">Revenue</CardTitle>
                        <CardDescription>{new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                        }).format(Detail.revenue)}</CardDescription>
                    </CardHeader>
                </>
                :
                <>
                    <CardHeader className="p-0">
                        <CardTitle className="text-base">Network</CardTitle>
                        <CardDescription className="flex flex-col gap-4">
                            {Detail.networks.map((item: any) => (
                                <Link to={`/network/${item.id}`}>
                                    <img src={`${imagePath}/original/${item.logo_path}`} className="w-40" alt="" />
                                </Link>
                            ))}
                        </CardDescription>
                    </CardHeader>
                    <CardHeader className="p-0">
                        <CardTitle className="text-base">Type</CardTitle>
                        <CardDescription>{Detail.type}</CardDescription>
                    </CardHeader>
                </>
            }
            <CardHeader className="p-0">
                <CardTitle className="text-base">Keywords</CardTitle>
                <div className="flex flex-wrap gap-2">
                    {!KeywordsPending ?
                        detailType === "movie" ?
                            Keywords?.keywords?.map((item: any) => (
                                <Link key={item.id} to={`/keyword/${item.id}-${(item.name).toLowerCase().replace(/ /g, "-")}/${detailType}`} className="px-3 py-1 text-sm font-semibold duration-200 ease-out rounded-sm hover:bg-primary/90 bg-primary text-primary-foreground">{item.name}</Link>
                            ))
                            :
                            Keywords?.results?.map((item: any) => (
                                <Link key={item.id} to={`/keyword/${item.id}-${(item.name).toLowerCase().replace(/ /g, "-")}/${detailType}`} className="px-3 py-1 text-sm font-semibold duration-200 ease-out rounded-sm hover:bg-primary/90 bg-primary text-primary-foreground">{item.name}</Link>
                            ))
                        :
                        <Skeleton className="w-4 h-2" />
                    }
                </div>
            </CardHeader>
        </Card>
    );
}

export default ContentAside;