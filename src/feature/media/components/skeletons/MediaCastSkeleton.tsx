import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const MediaCastSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-6">
            <Skeleton className="w-1/3 h-6" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="w-full h-24" />
                ))}
            </div>
        </div>
    );
};

export default MediaCastSkeleton;