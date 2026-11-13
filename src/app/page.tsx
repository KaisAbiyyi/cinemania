import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import GenreList from "@/feature/genre/components/GenreList";
import HeroSection from "@/feature/home/hero/HeroSection";
import MediaScrollableList from "@/feature/media/components/MediaScrollableList";
import { createSiteMetadata } from "@/lib/metadata";
import { Metadata } from "next";

const siteMetadata = createSiteMetadata();

export const metadata: Metadata = {
  ...siteMetadata,
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (<>
    <HeroSection />
    <GenreList />
    <MediaScrollableList showOnly={10} title="Popular Movies" redirectTo="movie" orientation="horizontal" type="movie" />
    <MediaScrollableList showOnly={10} title="Popular TV Series" redirectTo="tv" orientation="horizontal" type="tv" />
    <Tabs defaultValue="now-playing" className="p-8 -mx-8 bg-gradient-to-tl from-indigo-950 via via-indigo-950 to-primary">
      <TabsList className="z-10 bg-indigo-950">
        <TabsTrigger value="now-playing" className="data-[state=active]:bg-gradient-to-tl data-[state=active]:from-indigo-950 data-[state=active]:via-primary data-[state=active]:to-primary data-[state=active]:text-primary-foreground text-slate-100">Now Playing Movies</TabsTrigger>
        <TabsTrigger value="upcoming" className="data-[state=active]:bg-gradient-to-tl data-[state=active]:from-indigo-950 data-[state=active]:via-primary data-[state=active]:to-primary data-[state=active]:text-primary-foreground text-slate-100">Upcoming Movies</TabsTrigger>
      </TabsList>
      <TabsContent value="now-playing">
        <MediaScrollableList
          redirectToButtonVariant="default"
          title=""
          redirectTo="movie/now-playing"
          orientation="horizontal"
          showOnly={5}
          datePreset="movie-now-playing"
          type="movie" />
      </TabsContent>
      <TabsContent value="upcoming">
        <MediaScrollableList
          redirectToButtonVariant="default"
          title=""
          redirectTo="movie/upcoming"
          orientation="horizontal"
          showOnly={5}
          datePreset="movie-upcoming"
          type="movie" />
      </TabsContent>
    </Tabs>
    <MediaScrollableList
      title="Top Rated Movies"
      redirectTo="movie/top-rated"
      orientation="vertical"
      queryParams={
        {
          sort_by: "vote_average.desc",
          without_genres: "99,10755",
          "vote_count.gte": 350
        }
      }
      showOnly={3}
      type="movie" />
  </>
  );
}
