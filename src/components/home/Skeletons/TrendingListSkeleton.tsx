import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const TrendingListSkeleton: FC = () => {


    return (
        <div className="flex flex-col gap-8 p-4">
            <div className="flex items-center gap-8">
                <CardTitle>Trending</CardTitle>
                <div className="flex overflow-hidden rounded-full bg-secondary">
                    <Button
                        variant="default"
                        className="rounded-full"
                        size="sm"
                        type="button"
                        disabled
                    >
                        Today
                    </Button>
                    <Button
                        variant="ghost"
                        className="rounded-full"
                        size="sm"
                        type="button"
                        disabled
                    >
                        This Week
                    </Button>
                </div>
            </div>
            <div className="flex gap-4 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                <Skeleton className="w-64 h-96" />
                <Skeleton className="w-64 h-96" />
                <Skeleton className="w-64 h-96" />
                <Skeleton className="w-64 h-96" />
                <Skeleton className="w-64 h-96" />
            </div>
        </div>
    );
}

export default TrendingListSkeleton;