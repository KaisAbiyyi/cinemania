import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";
import { Link } from "react-router-dom";


interface TopBilledCastSkeletonProps {
    pathName: string
}

const TopBilledCastSkeleton: FC<TopBilledCastSkeletonProps> = ({ pathName }) => {
    return (
        <Card className="flex flex-col gap-8 p-8 border-none bg-background rounded-3xl">
            <CardHeader className="flex flex-row items-center justify-between p-0">
                <CardTitle className="text-lg">Cast</CardTitle>
                <Link to={`${pathName}/cast`} className="p-2 px-4 text-base font-semibold duration-200 ease-out rounded-full hover:text-primary-foreground hover:bg-primary">
                    View full cast and crew
                </Link>
            </CardHeader>
            <CardContent className="relative flex flex-col p-0">
                <div className="absolute top-0 bottom-0 right-0 z-10 w-1/2 pointer-events-none bg-gradient-to-l from-background via-transparent to-transparent"></div>
                <div className="flex w-full gap-4 overflow-x-scroll scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
                    <Skeleton className="relative h-48 overflow-hidden rounded-t-lg group lg:h-60 min-w-32 lg:min-w-44" />
                    <Skeleton className="relative h-48 overflow-hidden rounded-t-lg group lg:h-60 min-w-32 lg:min-w-44" />
                    <Skeleton className="relative h-48 overflow-hidden rounded-t-lg group lg:h-60 min-w-32 lg:min-w-44" />
                    <Skeleton className="relative h-48 overflow-hidden rounded-t-lg group lg:h-60 min-w-32 lg:min-w-44" />
                    <Skeleton className="relative h-48 overflow-hidden rounded-t-lg group lg:h-60 min-w-32 lg:min-w-44" />
                </div>
            </CardContent>
        </Card>
    );
}

export default TopBilledCastSkeleton;