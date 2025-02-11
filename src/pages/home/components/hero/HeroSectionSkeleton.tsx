import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";
const HeroSectionSkeleton: FC = () => {
    return (
        <Skeleton className="h-[70vh] rounded-lg" />
    );
}

export default HeroSectionSkeleton;