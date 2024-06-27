import { Skeleton } from "@/components/ui/skeleton";


const TrendingSliderSkeleton = () => {
    return (
        <div className="relative flex flex-col h-[700px] overflow-hidden">
            <Skeleton className="h-[700px] rounded-none" />
            <Skeleton className="absolute inset-0 flex justify-between w-full h-full gap-4 p-16 rounded-none bg-gradient-to-t from-background to-primary/30">
                <div className="flex flex-col gap-4">

                </div>
                <div className="flex items-end gap-4">
                    <Skeleton className="h-56 opacity-50 w-36" />
                    <Skeleton className="h-56 opacity-50 w-36" />
                    <Skeleton className="h-56 opacity-50 w-36" />
                </div>
            </Skeleton>
        </div>
    );
}

export default TrendingSliderSkeleton;