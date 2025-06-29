import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const DetailBackBannerSkeleton: FC = () => {
    return (
        <Skeleton className="relative flex items-center gap-4 p-4 animate-pulse">
            <Skeleton className="w-12 h-12  rounded" />
            <Skeleton className="w-24  rounded h-36" />
            <div className="flex flex-col gap-2">
                <Skeleton className="w-48 h-6  rounded" />
                <Skeleton className="w-32 h-4  rounded" />
            </div>
        </Skeleton>
    );
};

export default DetailBackBannerSkeleton;