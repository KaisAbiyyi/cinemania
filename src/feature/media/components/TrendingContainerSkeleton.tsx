import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

interface TrendingContainerSkeletonProps {
    orientation?: "horizontal" | "vertical";
}

const gridClass: Record<"horizontal" | "vertical", string> = {
    horizontal: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
    vertical: "grid-cols-1 lg:grid-cols-2",
};

const TrendingContainerSkeleton: FC<TrendingContainerSkeletonProps> = ({
    orientation = "horizontal",
}) => {
    return (
        <div className={`grid gap-4 ${gridClass[orientation]}`}>
            {Array.from({ length: 12 }, (_, index) => (
                <Skeleton key={index} className="w-full h-72 md:h-80" />
            ))}
        </div>
    );
};

export default TrendingContainerSkeleton;
