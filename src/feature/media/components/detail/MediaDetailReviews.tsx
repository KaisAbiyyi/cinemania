"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn, getInitials, getProfileImageUrl } from "@/lib/utils";
import { formatDate } from "date-fns";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FC, useMemo, useState } from "react";
import { useMediaReviews } from "../../hooks/useMediaReviews";
import { MediaReviews } from "../../hooks/useMediaReviews";
import MediaDetailReviewsSkeleton from "../skeletons/MediaDetailReviewsSkeleton";
import ReviewCard from "../reviews/ReviewCard";

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

    if (error || !data || !data.results.length || !sortedReviews.length) {
        return <p className="text-muted-foreground">No reviews available.</p>;
    }

    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10">
            <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Top Reviews</h1>
                    <Link
                        href={`${pathname}/reviews`}
                        className={buttonVariants({ variant: "ghost", className: "w-fit" })}
                    >
                        Read All Reviews
                        <ChevronRight />
                    </Link>
                </div>
            </div>
            <Card className="bg-transparent">
                {sortedReviews.map((review) => (
                    <ReviewCard data={review} key={review.id} />
                ))}
            </Card>
            {sortedReviews.length === 0 && (
                <p className="text-muted-foreground">No reviews available.</p>
            )}
        </div>
    );
};

export default MediaDetailReviews;
