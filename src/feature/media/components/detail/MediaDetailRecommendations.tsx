import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
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
        refetch,
    } = useMediaRecommendations({ id, mediaType });

    if (similarLoading) {
        return (
            <div role="status" aria-label="Loading recommendations">
                <MediaDetailRecommendationsSkeleton />
            </div>
        );
    }
    if (similarError) {
        return (
            <ErrorState
                message={similarError.message || "Failed to load recommendations."}
                onRetry={() => void refetch()}
            />
        );
    }
    if (!similarData) {
        return <EmptyState title="No recommendations" message="No recommendations available." />;
    }

    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Recommendations</h1>
                </div>
            </div>
            {similarData.results.length === 0 ? (
                <EmptyState
                    title="No recommendations"
                    message="No recommended media available."
                />
            ) : (
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
            )}
        </div>
    );
}

export default MediaDetailRecommendations;