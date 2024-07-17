import { FC } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { CardDescription, CardTitle } from "../ui/card";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";

interface MediaContentProps {
    posters: {}[],
    backdrops: {}[],
}

const MediaContent: FC<MediaContentProps> = ({ posters, backdrops }) => {
    // console.log(posters)
    const { pathname } = useLocation()
    const imagePath = import.meta.env.VITE_TMDB_POSTER_URL
    console.log(posters)

    return (
        <Tabs defaultValue="backdrops" className="px-0 h-96">
            <div className="flex flex-col gap-2">
                <CardTitle className="text-lg">Media</CardTitle>
                <TabsList className="w-fit">
                    <TabsTrigger value="backdrops" className="flex gap-2">
                        <span>Backdrops</span>
                        <CardDescription className="font-thin">{backdrops.length}</CardDescription>
                    </TabsTrigger>
                    <TabsTrigger value="posters" className="flex gap-2">
                        <span>Posters</span>
                        <CardDescription className="font-thin">{posters.length}</CardDescription>
                    </TabsTrigger>
                </TabsList>
            </div>
            <TabsContent className="relative flex flex-col" value="backdrops">
                <div className="flex w-full overflow-x-scroll rounded-sm scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                    {backdrops.slice(0, 5).map((item: any) => (
                        <img src={`${imagePath}/w500/${item.file_path}`} key={item.id} className="object-cover aspect-video h-72" alt="" />
                    ))}
                    {backdrops.length > 10 &&
                        <Link to={`${pathname}/images/backdrops`} className="z-10 flex items-center justify-center p-4 ml-4 duration-200 ease-out rounded-lg hover:bg-primary/90 bg-primary text-primary-foregound">
                            <span className="m-0 text-lg font-bold">More</span>
                            <ChevronRight />
                        </Link>
                    }
                </div>
            </TabsContent>
            <TabsContent className="relative flex flex-col" value="posters">
                <div className="flex w-full overflow-x-scroll rounded-sm scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                    {posters.slice(0, 10).map((item: any) => (
                        <img src={`${imagePath}/w500/${item.file_path}`} key={item.id} className="object-cover h-72" alt="" />
                    ))}
                    {posters.length > 10
                        &&
                        <Link to={`${pathname}/images/posters`} className="z-10 flex items-center justify-center p-4 ml-4 duration-200 ease-out rounded-lg hover:bg-primary/90 bg-primary text-primary-foregound">
                            <span className="m-0 text-lg font-bold">More</span>
                            <ChevronRight />
                        </Link>
                    }
                </div>
            </TabsContent>
        </Tabs >
    );
}

export default MediaContent;