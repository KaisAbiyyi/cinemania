import { FC } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import MVGenreList from "./MVGenreList";
import TVGenreList from "./TVGenreList";


const GenreList: FC = () => {
    return (
        <Tabs defaultValue="movie">
            <TabsList>
                <TabsTrigger value="movie">Movie</TabsTrigger>
                <TabsTrigger value="tv">TV</TabsTrigger>
            </TabsList>
            <TabsContent value="movie">
                <MVGenreList />
            </TabsContent>
            <TabsContent value="tv">
                <TVGenreList />
            </TabsContent>
        </Tabs>

    );
}

export default GenreList;