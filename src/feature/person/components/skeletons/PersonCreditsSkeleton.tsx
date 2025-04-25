import { FC } from 'react';
import { Skeleton } from "@/components/ui/skeleton";

const PersonCreditsSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-2 md:gap-4 lg:gap-6">
            {/* Cast Section Skeleton */}
            <div className="flex flex-col gap-1 md:gap-3 lg:gap-5">
                <Skeleton className="w-32 h-6 md:h-8 md:w-40 lg:h-10 lg:w-48" />
                <div className="flex flex-col gap-1 md:gap-2 lg:gap-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="flex flex-col gap-2">
                            <Skeleton className="w-full h-48 md:h-56 lg:h-64" />
                            <Skeleton className="w-3/4 h-4" />
                            <Skeleton className="w-1/2 h-4" />
                        </div>
                    ))}
                </div>
            </div>

            {/* Crew Section Skeleton */}
            {Array.from({ length: 2 }).map((_, departmentIndex) => (
                <div key={departmentIndex} className="flex flex-col gap-1 md:gap-3 lg:gap-5">
                    <Skeleton className="w-32 h-6 md:h-8 md:w-40 lg:h-10 lg:w-48" />
                    <div className="flex flex-col gap-1 md:gap-2 lg:gap-3">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="flex flex-col gap-2">
                                <Skeleton className="w-full h-48 md:h-56 lg:h-64" />
                                <Skeleton className="w-3/4 h-4" />
                                <Skeleton className="w-1/2 h-4" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default PersonCreditsSkeleton;
