import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { FC } from "react";

interface MediaScrollableListSkeletonProps {
    orientation: "vertical" | "horizontal";
    title: string
    redirectTo?: string
    className?: string
}

const MediaScrollableListSkeleton: FC<MediaScrollableListSkeletonProps> = ({ orientation = "horizontal", title, redirectTo, className }) => {
    return (
        <section className={cn("flex flex-col gap-6", !title && "-mt-12")}>
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">{title}</h1>
                {redirectTo && (
                    <Link href={`/${redirectTo}`} className={buttonVariants({ variant: "ghost", className: "w-fit" })}>
                        More
                        <ChevronRight />
                    </Link>
                )}
            </div>
            <div className={cn("gap-4 flex", orientation === "vertical" ? " flex-col overflow-y-auto" : "overflow-x-auto pb-6", className)}>
                {Array.from({ length: 7 }).map((_, index) => {
                    if (orientation === "vertical") {
                        return (
                            <Skeleton className="h-72" key={index} />
                        )
                    }
                    return (
                        <Skeleton className="w-56 md:h-80 h-72" key={index} />
                    )
                })}
            </div>
        </section>
    )
}

export default MediaScrollableListSkeleton;