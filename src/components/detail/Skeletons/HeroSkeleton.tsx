import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";


const HeroSkeleton: FC = () => {
    return (
        <div className="bg-gradient-to-b from-primary gap-8 flex items-center p-16 via-primary/80 to-transparent h-[800px] w-full">
            <Skeleton className="w-96 h-[500px]" />
            <div className="flex flex-col flex-grow gap-4">
                <Skeleton className="h-16 w-96" />
                <Skeleton className="h-10 w-80" />
                <Skeleton className="w-64 mt-6 h-9" />
                <Skeleton className="w-40 h-12" />
                <Skeleton className="w-full h-40" />
            </div>
        </div>
    );
}

export default HeroSkeleton;