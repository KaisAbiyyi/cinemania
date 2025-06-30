import { Alert, AlertDescription } from "@/components/ui/alert";
import { FC } from "react";
import { useMediaRecommendations } from "../../hooks/useMediaRecommendations";
import MediaCard from "../MediaCard";
import MediaDetailRecommendationsSkeleton from "../skeletons/MediaDetailRecommendationsSkeleton";

interface MediaDetailRecommendationsProps {
    id: number
    mediaType: "movie" | "tv";
}

const MediaDetailRecommendations: FC<MediaDetailRecommendationsProps> = ({ id, mediaType }) => {
    const {
        data: similarData,
        isLoading: similarLoading,
        error: similarError,
    } = useMediaRecommendations({ id, mediaType });

    if (similarLoading) return <MediaDetailRecommendationsSkeleton />;
    if (similarError || !similarData) return <div>Error fetching similar media</div>;

    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Recommendations</h1>
                </div>
            </div>
            <div className="flex flex-row gap-4 pb-6 overflow-x-auto">
                {similarData.results.map((media) => (
                    <div key={media.id} className="flex-shrink-0 md:w-40 lg:w-52">
                        {/* Use the MediaCard component to display each media item */}
                        <MediaCard
                            id={media.id}
                            posterPath={media.poster_path}
                            rating={media.vote_average}
                            title={media.title || media.name}
                            releaseDate={media.release_date || media.first_air_date}
                            description={media.overview}
                            genre_ids={media.genre_ids}
                            layout="horizontal"
                            mediaType={mediaType} />
                    </div>
                ))}
            </div>
            {similarData.results.length === 0 && (
                <Alert className="-mt-20">
                    <AlertDescription>No recommended media available.</AlertDescription>
                </Alert>
            )}
        </div>
    );
}

export default MediaDetailRecommendations;