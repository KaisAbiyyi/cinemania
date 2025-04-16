"use client";

import { FC, Fragment } from "react";
import { useInfiniteMediaReviews } from "../../hooks/useMediaReviews";
import ReviewCard from "./ReviewCard";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import MediaReviewsWrapperSkeleton from "../skeletons/MediaReviewsWrapperSkeleton";

interface MediaReviewsWrapperProps {
    id: number;
    mediaType: "movie" | "tv";
}

const MediaReviewsWrapper: FC<MediaReviewsWrapperProps> = ({ id, mediaType }) => {
    const {
        data,
        isLoading,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useInfiniteMediaReviews({ id, mediaType });

    if (isLoading) {
        return <MediaReviewsWrapperSkeleton />;
    }

    if (error || !data) {
        return <div>Error loading reviews</div>;
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
                {data.pages.flatMap((page) => page.results).length > 0 ? (
                    <Card className="bg-transparent">
                        {data.pages.flatMap((page) => page.results).map((review, index) => (
                            <Fragment key={review.id}>
                                <ReviewCard data={review} />
                                {index < data.pages.flatMap((page) => page.results).length - 1 && <Separator />}
                            </Fragment>
                        ))}
                    </Card>
                ) : (
                    <p>No reviews available.</p>
                )}
            </div>
            {hasNextPage && (
                <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="self-center px-4 py-2 mt-4 text-white bg-blue-500 rounded hover:bg-blue-600 disabled:opacity-50"
                >
                    {isFetchingNextPage ? "Loading more..." : "Load More"}
                </button>
            )}
        </div>
    );
};

export default MediaReviewsWrapper;