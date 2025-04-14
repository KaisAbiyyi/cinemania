import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

interface Props {
    orientation: "horizontal" | "vertical";
    itemsPerPage: number;
}

const TrendingLoadMoreSkeleton: FC<Props> = ({ orientation, itemsPerPage }) => {
    // For horizontal layout, return appropriate skeleton cards
    const height = orientation === "horizontal" ? "h-72 md:h-80" : "h-72 md:h-64";

    return (
        <>
            {Array.from({ length: itemsPerPage }).map((_, index) => (
                // The skeleton is now just a card item in the grid
                <Skeleton
                    key={index}
                    className={`w-full ${height} rounded-lg`}
                />
            ))}
        </>
    );
};

export default TrendingLoadMoreSkeleton;