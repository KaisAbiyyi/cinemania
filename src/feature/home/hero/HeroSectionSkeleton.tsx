import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";
const HeroSectionSkeleton: FC = () => {
    return (
        <Skeleton className="h-[50vh] md:h-[700px] rounded-lg" />
    );
}

export default HeroSectionSkeleton;