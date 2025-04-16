"use client"

import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

const MediaReviewsWrapperSkeleton = () => {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
                <Card className="p-4 bg-transparent">
                    {[...Array(3)].map((_, idx) => (
                        <div key={idx} className="flex flex-col gap-4">
                            <div className="flex items-start gap-4">
                                <Skeleton className="w-10 h-10 rounded-full" />
                                <div className="flex flex-col flex-1 gap-2">
                                    <Skeleton className="w-1/3 h-4" />
                                    <Skeleton className="w-1/4 h-3" />
                                </div>
                                <Skeleton className="w-10 h-6 rounded bg-primary/40" />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Skeleton className="w-full h-3" />
                                <Skeleton className="h-3 w-[90%]" />
                                <Skeleton className="h-3 w-[80%]" />
                                <Skeleton className="h-3 w-[70%]" />
                            </div>
                        </div>
                    ))}
                </Card>
            </div>
        </div>
    )
}

export default MediaReviewsWrapperSkeleton
