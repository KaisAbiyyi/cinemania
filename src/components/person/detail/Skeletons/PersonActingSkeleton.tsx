import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const PersonActingSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-8">
            <Skeleton className="w-24 h-8" />
            <div className="flex items-start gap-8 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                <Skeleton className="w-36 h-60" />
                <Skeleton className="w-36 h-60" />
                <Skeleton className="w-36 h-60" />
                <Skeleton className="w-36 h-60" />
                <Skeleton className="w-36 h-60" />
            </div>
            <Skeleton className="w-24 h-8" />
            <div className="flex flex-col gap-4">
                <Skeleton className="w-16"/>
                <Skeleton className="w-16"/>
                <Skeleton className="w-16"/>
                <Skeleton className="w-16"/>
                <Skeleton className="w-16"/>
            </div>
        </div>
    );
}

export default PersonActingSkeleton;