"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CardContent, CardHeader } from "@/components/ui/card";
import { cn, getInitials, getProfileImageUrl } from "@/lib/utils";
import { formatDate } from "date-fns";
import { FC, useState } from "react";
import { MediaReviews, Review } from "../../hooks/useMediaReviews";

interface ReviewCardProps {
    data: Review
}

const ReviewCard: FC<ReviewCardProps> = ({ data }) => {
    const [expanded, setExpanded] = useState(false);


    return (
        <div className="flex flex-col gap-4 md:gap-6" key={data.id}>
            <CardHeader className="flex flex-row items-start justify-between">
                <div className="flex flex-row items-center gap-2 md:gap-4 lg:gap-6">
                    <Avatar>
                        <AvatarImage
                            src={getProfileImageUrl(data.author_details.avatar_path as string)}
                        />
                        <AvatarFallback>
                            {getInitials(data.author_details.name as string)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-1 md:gap-2">
                        <div className="flex gap-2">
                            <h4 className="font-bold">{data.author}</h4>
                            <span className="font-secondary-foreground/70">
                                {data.author_details.username}
                            </span>
                        </div>
                        <span>{formatDate(new Date(data.updated_at), "MMMM dd, yyyy")}</span>
                    </div>
                </div>
                <span className="px-1 text-xs font-bold rounded bg-primary h-fit text-primary-foreground">
                    {data.author_details.rating?.toFixed(1)}
                </span>
            </CardHeader>
            <CardContent>
                <p className={cn("whitespace-pre-wrap", !expanded && "line-clamp-5")}>
                    {data.content}
                </p>
                {data.content.split(" ").length > 50 && (
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