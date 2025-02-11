import { FC } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const GenreListSkeleton: FC = () => {
    return (
        <div className="flex gap-4 mt-5">
            <Skeleton className="w-40 h-10 rounded-lg" />
            <Skeleton className="w-40 h-10 rounded-lg" />
            <Skeleton className="w-40 h-10 rounded-lg" />
            <Skeleton className="w-40 h-10 rounded-lg" />
            <Skeleton className="w-40 h-10 rounded-lg" />
            <Skeleton className="w-40 h-10 rounded-lg" />
        </div>
    );
}

export default GenreListSkeleton;