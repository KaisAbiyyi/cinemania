"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FC, useMemo } from "react";
import { MediaReviews, useMediaReviews } from "../../hooks/useMediaReviews";
import ReviewCard from "../reviews/ReviewCard";
import MediaDetailReviewsSkeleton from "../skeletons/MediaDetailReviewsSkeleton";

interface MediaDetailReviewsProps {
    id: number;
    mediaType: "movie" | "tv";
}

const MediaDetailReviews: FC<MediaDetailReviewsProps> = ({ id, mediaType }) => {
    const pathname = usePathname();

    const { data, isLoading, error } = useMediaReviews({
        id,
        mediaType,
        language: "en-US",
    });

    const sortedReviews: MediaReviews["results"] = useMemo(() => {
        if (!data || !data.results.length) return [];
        const randomIndex = Math.floor(Math.random() * data.results.length);
        return [data.results[randomIndex]];
    }, [data]);

    if (isLoading) {
        return <MediaDetailReviewsSkeleton />;
    }

    if (error || !data) {
        return <p className="text-muted-foreground">No reviews available.</p>;
    }

    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Top Reviews</h1>
                    {sortedReviews.length > 0 &&
                        <Link
                            href={`${pathname}/reviews`}
                            className={buttonVariants({ variant: "ghost", className: "w-fit" })}
                        >
                            Read All Reviews
                            <ChevronRight />
                        </Link>
                    }
                </div>
            </div>
            {sortedReviews.length > 0 ?
                <Card className="bg-transparent">
                    {sortedReviews.map((review) => (
                        <ReviewCard data={review} key={review.id} />
                    ))}
                </Card>
                :
                <Alert>
                    <AlertDescription>No review available.</AlertDescription>
                </Alert>
            }
        </div>
    );
};

export default MediaDetailReviews;
