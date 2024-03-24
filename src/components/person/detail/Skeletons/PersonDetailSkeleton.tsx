import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";


const PersonDetailSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-8 p-2 lg:gap-16 lg:flex-row lg:p-16">
            <Skeleton className="w-full overflow-hidden lg:w-2/4 xl:w-1/4 h-[500px]" />
            <div className="flex flex-col w-full gap-8 lg:w-2/4 xl:w-3/5">
                <Skeleton className="h-12 w-96" />
                <div className="flex flex-col gap-4">
                    <Skeleton className="w-full h-8" />
                    <Skeleton className="w-3/4 h-8" />
                    <Skeleton className="w-5/6 h-8" />
                    <Skeleton className="w-2/5 h-8" />
                </div>
            </div>
        </div>
    );
}

export default PersonDetailSkeleton;