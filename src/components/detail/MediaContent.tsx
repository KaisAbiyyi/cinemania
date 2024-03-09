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
    console.log(posters)
    const { pathname } = useLocation()
    const imagePath = import.meta.env.VITE_TMDB_POSTER_URL

    return (
        <Tabs defaultValue="backdrops" className="px-8 h-96">
            <div className="flex flex-col gap-2">
                <CardTitle className="text-lg">Media</CardTitle>
                <TabsList className="w-fit">
                    {/* <TabsTrigger value="videos">Videos</TabsTrigger> */}
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
            {/* <TabsContent className="m-0 bg-secondary" value="videos">Make changes to your account here. Lorem ipsum dolor, sit amet consectetur adipisicing elit. Inventore expedita explicabo laborum eos. Excepturi sit unde quia aliquam nam tempore, veritatis ducimus laudantium accusantium non molestiae inventore itaque, amet neque culpa libero mollitia distinctio! Dolorum sint, tempore earum accusantium dolor facilis officia eos excepturi. Ullam temporibus accusamus omnis voluptatibus dolor a sunt molestiae quia iste magnam sint, excepturi obcaecati natus veritatis perspiciatis fuga adipisci minus quaerat esse sed consequuntur quas eveniet ut. Perspiciatis, maxime accusantium! Similique eius unde voluptates autem blanditiis soluta provident enim, officiis id totam magni. Optio veniam necessitatibus quod quasi porro velit aliquid ducimus rem quibusdam? Quas minus distinctio voluptas sint dolore nostrum, repellendus ipsum magni unde velit veritatis ipsa voluptatum? Odio consequuntur inventore dolor adipisci dolore sed iure repudiandae magnam facilis assumenda maiores cumque, nostrum mollitia ipsam culpa repellendus esse necessitatibus exercitationem praesentium quam sit expedita quo unde tenetur! Consequuntur eligendi voluptatem velit possimus voluptates, accusantium, dolores quo maiores, commodi suscipit perspiciatis eaque minima voluptate dolorem! Aspernatur maxime nemo dignissimos ullam velit laboriosam nisi nesciunt alias dolor reprehenderit repudiandae enim id ipsa iure magnam voluptatum, quam ex distinctio vitae reiciendis praesentium facilis debitis aliquam. Quisquam beatae laborum commodi reprehenderit tempora vitae, cumque et vero illum esse.</TabsContent> */}
            <TabsContent className="relative flex flex-col" value="backdrops">
                <div className="absolute top-0 bottom-0 right-0 z-0 w-1/2 pointer-events-none bg-gradient-to-l from-background via-transparent to-transparent"></div>
                <div className="flex w-full overflow-x-scroll rounded-sm scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                    {backdrops.slice(0, 5).map((item: any) => (
                        <img src={`${imagePath}/w500/${item.file_path}`} className="object-cover aspect-video h-72" alt="" />
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
                <div className="absolute top-0 bottom-0 right-0 z-0 w-1/2 pointer-events-none bg-gradient-to-l from-background via-transparent to-transparent"></div>
                <div className="flex w-full overflow-x-scroll rounded-sm scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                    {posters.slice(0, 10).map((item: any) => (
                        <img src={`${imagePath}/w500/${item.file_path}`} className="object-cover h-72" alt="" />
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