import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const DetailBackBannerSkeleton: FC = () => {
    return (
        <div className="relative flex items-center gap-4 p-4 bg-gray-200 animate-pulse">
            <Skeleton className="w-12 h-12 bg-gray-300 rounded" />
            <Skeleton className="w-24 bg-gray-300 rounded h-36" />
            <div className="flex flex-col gap-2">
                <Skeleton className="w-48 h-6 bg-gray-300 rounded" />
                <Skeleton className="w-32 h-4 bg-gray-300 rounded" />
            </div>
        </div>
    );
};

export default DetailBackBannerSkeleton;