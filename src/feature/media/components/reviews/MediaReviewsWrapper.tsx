"use client";

import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";
import { dedupeInfinitePages } from "../../utils/mediaPagination";

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
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
    } = useInfiniteMediaReviews({ id, mediaType });

    if (isLoading) {
        return (
            <div role="status" aria-label="Loading reviews">
                <MediaReviewsWrapperSkeleton />
            </div>
        );
    }

    if (error && !isFetchNextPageError) {
        return (
            <ErrorState
                message={error.message || "Error loading reviews."}
                onRetry={() => void refetch()}
            />
        );
    }

    const reviews = dedupeInfinitePages(data?.pages, (review) => review.id);

    if (reviews.length === 0) {
        return <EmptyState title="No reviews" message="No reviews available." />;
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
                <Card className="bg-transparent">
                    {reviews.map((review, index) => (
                        <Fragment key={review.id}>
                            <ReviewCard data={review} />
                            {index < reviews.length - 1 && <Separator />}
                        </Fragment>
                    ))}
                </Card>
            </div>
            {isFetchNextPageError && (
                <ErrorState
                    title="Unable to load more reviews"
                    message="There was an error loading more reviews."
                    onRetry={() => void fetchNextPage()}
                />
            )}
            {hasNextPage && !isFetchNextPageError && (
                <button
                    type="button"
                    onClick={() => void fetchNextPage()}
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