import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "lucide-react";
import { FC } from "react";
import { useLocation } from "react-router-dom";

const ReviewSkeleton: FC = () => {
    const {pathname} = useLocation()
    
    return (<Card className="flex flex-col gap-8 p-8 mb-8 border-none bg-background">
        <CardHeader className="flex flex-row items-center justify-between p-0">
            <div className="flex items-center gap-4">
                <CardTitle className="text-lg">Reviews</CardTitle>
                <CardDescription></CardDescription>
            </div>
            <Link to={`${pathname}/reviews`} className="p-2 px-4 text-base font-semibold duration-200 ease-out rounded-full hover:text-primary-foreground hover:bg-primary">Read All Reviews</Link>
        </CardHeader>
        <CardContent className="border shadow-sm bg-secondary/70 rounded-xl ">
            <CardHeader className="flex gap-4 px-0">
                <Skeleton className="w-12 h-12 rounded-full" />
                <div className="flex flex-col gap-2"></div>
            </CardHeader>
        </CardContent>
    </Card>);
}

export default ReviewSkeleton;