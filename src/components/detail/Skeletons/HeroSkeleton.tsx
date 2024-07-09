import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";


const HeroSkeleton: FC = () => {
    return (
        <div className="flex items-center w-full h-[700px] gap-8 p-16 bg-gradient-to-b from-primary via-primary/80 to-transparent">
            <Skeleton className="hidden w-64 border rounded-lg lg:block xl:w-50 xl:h-[400px] object-cover drop-shadow-2xl" />
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