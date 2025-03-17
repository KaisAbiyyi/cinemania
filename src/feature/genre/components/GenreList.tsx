import { FC } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MediaGenreList from "./MediaGenreList";


const GenreList: FC = () => {
    return (
        <Tabs defaultValue="movie">
            <TabsList>
                <TabsTrigger value="movie">Movie</TabsTrigger>
                <TabsTrigger value="tv">TV</TabsTrigger>
            </TabsList>
            <TabsContent value="movie">
                <MediaGenreList type="movie" />
            </TabsContent>
            <TabsContent value="tv">
                <MediaGenreList type="tv" />
            </TabsContent>
        </Tabs>

    );
}

export default GenreList;