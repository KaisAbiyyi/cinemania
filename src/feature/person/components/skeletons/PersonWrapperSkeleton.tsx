import { FC } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

const PersonWrapperSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-4 md:gap-6 lg:gap-8">
            {/* Banner Skeleton */}
            <div className="w-full h-48 bg-gray-200 rounded-md md:h-64 lg:h-80">
                <Skeleton className="w-full h-full" />
            </div>

            <div className="flex justify-end gap-4">
                {/* Sidebar Skeleton */}
                <div className="hidden w-3/12 lg:block">
                    <Skeleton className="w-full h-64 rounded-md" />
                </div>

                {/* Main Content Skeleton */}
                <div className="flex flex-col w-full gap-4 lg:w-9/12 md:gap-6 lg:gap-8">
                    {/* Detail Images Skeleton */}
                    <div className="grid grid-cols-2 gap-4">
                        <Skeleton className="w-full h-40 rounded-md" />
                        <Skeleton className="w-full h-40 rounded-md" />
                    </div>

                    {/* Credits Skeleton */}
                    <div className="flex flex-col gap-4">
                        <Skeleton className="w-1/2 h-6 rounded-md" />
                        <div className="grid grid-cols-2 gap-4">
                            <Skeleton className="w-full h-32 rounded-md" />
                            <Skeleton className="w-full h-32 rounded-md" />
                            <Skeleton className="w-full h-32 rounded-md" />
                            <Skeleton className="w-full h-32 rounded-md" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PersonWrapperSkeleton;
