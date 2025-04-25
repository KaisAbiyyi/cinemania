import { FC } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const PersonImageWrapperSkeleton: FC = () => {
    return (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="w-full h-40 rounded-md" />
            ))}
        </div>
    );
};

export default PersonImageWrapperSkeleton;
