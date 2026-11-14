"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CardContent, CardHeader } from "@/components/ui/card";
import { cn, getInitials, getProfileImageUrl } from "@/lib/utils";
import { formatDate } from "date-fns";
import { FC, useState } from "react";
import { Review } from "../../hooks/useMediaReviews";

interface ReviewCardProps {
    data: Review
}

const ReviewCard: FC<ReviewCardProps> = ({ data }) => {
    const [expanded, setExpanded] = useState(false);
    const authorDetails = data.author_details;
    const authorName = authorDetails?.name || data.author || "Anonymous";
    const updatedDate = data.updated_at ? new Date(data.updated_at) : null;
    const formattedDate =
        updatedDate && !Number.isNaN(updatedDate.getTime())
            ? formatDate(updatedDate, "MMMM dd, yyyy")
            : "Unknown date";
    const content = data.content ?? "";

    return (
        <div className="flex flex-col gap-4 md:gap-6" key={data.id}>
            <CardHeader className="flex flex-row items-start justify-between">
                <div className="flex flex-row items-center gap-2 md:gap-4 lg:gap-6">
                    <Avatar>
                        <AvatarImage
                            src={getProfileImageUrl(authorDetails?.avatar_path)}
                        />
                        <AvatarFallback>
                            {getInitials(authorName)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-1 md:gap-2">
                        <div className="flex gap-2">
                            <h4 className="font-bold">{data.author || authorName}</h4>
                            {authorDetails?.username && (
                                <span className="font-secondary-foreground/70">
                                    {authorDetails.username}
                                </span>
                            )}
                        </div>
                        <span>{formattedDate}</span>
                    </div>
                </div>
                {typeof authorDetails?.rating === "number" && (
                    <span className="px-1 text-xs font-bold rounded bg-primary h-fit text-primary-foreground">
                        {authorDetails.rating.toFixed(1)}
                    </span>
                )}
            </CardHeader>
            <CardContent>
                <p className={cn("whitespace-pre-wrap", !expanded && "line-clamp-5")}>
                    {content}
                </p>
                {content.split(" ").length > 50 && (
                    <button
                        className="mt-2 font-medium text-primary"
                        onClick={() => setExpanded((prev) => !prev)}
                    >
                        {expanded ? "Show Less" : "Read More"}
                    </button>
                )}
            </CardContent>
        </div>
    );
}

export default ReviewCard;