import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import GenreList from "@/feature/genre/components/GenreList";
import HeroSection from "@/feature/home/hero/HeroSection";
import MediaScrollableList from "@/feature/media/components/MediaScrollableList";
import { Metadata } from "next";

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Cinemania - Explore Movies & TV Shows",
  description: "Discover trending movies and TV shows with Cinemania.",
  keywords: ["movies", "tv shows", "trending", "watchlist", "favorites", "cinema"],
  openGraph: {
    title: "Cinemania",
    description: "Explore the latest movies and TV shows.",
    url: "https://cinemania.com",
    siteName: "Cinemania",
    type: "website",
    images: [
      {
        url: "https://cinemania.com/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Cinemania Banner",
      },
    ],
  },
};

export default function Home() {
  const today = new Date();
  const oneMonthBefore = new Date();
  oneMonthBefore.setMonth(oneMonthBefore.getMonth() - 1)
  const oneMonthAfter = new Date();
  oneMonthAfter.setMonth(oneMonthAfter.getMonth() + 1)

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
          queryParams={
            {
              with_release_type: "2|3",
              "release_date.gte": oneMonthBefore.toISOString(),
              "release_date.lte": today.toISOString()
            }
          } type="movie" />
      </TabsContent>
      <TabsContent value="upcoming">
        <MediaScrollableList
          redirectToButtonVariant="default"
          title=""
          redirectTo="movie/upcoming"
          orientation="horizontal"
          showOnly={5}
          queryParams={
            {
              with_release_type: "2|3",
              "release_date.gte": today.toISOString(),
              "release_date.lte": oneMonthAfter.toISOString()
            }
          }
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