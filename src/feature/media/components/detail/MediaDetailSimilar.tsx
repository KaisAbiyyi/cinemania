import { FC } from "react";
import { useMediaSimilar } from "../../hooks/useMediaSimilar";
import MediaCard from "../MediaCard";
import MediaDetailSimilarSkeleton from "../skeletons/MediaDetailSimilarSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";

interface MediaDetailSimilarProps {
    id: number
    mediaType: "movie" | "tv";
}

const MediaDetailSimilar: FC<MediaDetailSimilarProps> = ({ id, mediaType }) => {
    const {
        data: similarData,
        isLoading: similarLoading,
        error: similarError,
        refetch,
    } = useMediaSimilar({ id, mediaType });

    if (similarLoading) {
        return (
            <div role="status" aria-label="Loading similar titles">
                <MediaDetailSimilarSkeleton />
            </div>
        );
    }
    if (similarError) {
        return (
            <ErrorState
                message={similarError.message || "Failed to load similar titles."}
                onRetry={() => void refetch()}
            />
        );
    }
    if (!similarData) {
        return <EmptyState title="No similar titles" message="No similar titles available." />;
    }

    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Similar</h1>
                </div>
            </div>
            {similarData.results.length === 0 ? (
                <EmptyState
                    title="No similar media"
                    message="No similar media available."
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

export default MediaDetailSimilar;