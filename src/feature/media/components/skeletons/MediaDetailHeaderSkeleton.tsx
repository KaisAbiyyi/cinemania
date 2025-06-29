import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

const MediaDetailHeaderSkeleton: FC = () => {
    return (
        <div className="flex h-[50vh] md:h-[700px] transition-all duration-75 ease-in items-end bg-secondary rounded-lg p-2 md:p-4 lg:p-6 xl:p-8 gap-2 md:gap-4 lg:gap-6 xl:gap-8">
            <section aria-label="Media Detail Header Skeleton" className="text-slate-100 animate-pulse">
                {/* Mobile */}
                <div className="block lg:hidden">
                    <div className="flex flex-row items-start gap-4">
                        <Skeleton className="w-32 h-[180px] rounded-lg" />
                        <div className="flex flex-col gap-3 flex-1">
                            <Skeleton className="h-6 w-2/3 rounded-md" />
                            <div className="flex flex-col gap-3">
                                <div className="flex gap-2 flex-wrap font-bold text-sm">
                                    <Skeleton className="w-8 h-5 rounded-md" />
                                    <Skeleton className="w-10 h-5 rounded-md" />
                                    <Skeleton className="w-12 h-5 rounded-md" />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Skeleton className="w-16 h-6 rounded-md" />
                                    <Skeleton className="w-20 h-6 rounded-md" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 space-y-2">
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <div className="mt-4 space-y-4">
                            <div className="space-y-1">
                                <Label className="text-slate-300 text-xs">Director</Label>
                                <Skeleton className="h-4 w-1/3" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-slate-300 text-xs">Writers</Label>
                                <div className="flex gap-2 flex-wrap">
                                    <Skeleton className="w-20 h-4" />
                                    <Skeleton className="w-16 h-4" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Desktop */}
                <div className="hidden lg:flex flex-row gap-8 items-start">
                    <Skeleton className="w-56 h-80 rounded-lg" />

                    <div className="flex flex-col gap-8 w-full">
                        <div className="flex flex-col gap-4">
                            <Skeleton className="h-7 w-2/5 rounded-md" />
                            <div className="flex gap-4 flex-wrap items-center">
                                <Skeleton className="w-8 h-5 rounded-md" />
                                <Skeleton className="w-10 h-5 rounded-md" />
                                <Skeleton className="w-12 h-5 rounded-md" />
                                <div className="flex flex-wrap gap-2">
                                    <Skeleton className="w-20 h-6 rounded-md" />
                                    <Skeleton className="w-20 h-6 rounded-md" />
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <Skeleton className="h-5 w-3/4" />
                            <Skeleton className="h-4 w-full" />
                        </div>

                        <div className="flex gap-6">
                            <div className="flex flex-col gap-2">
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="h-4 w-28" />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Skeleton className="w-20 h-4" />
                                <div className="flex gap-2 flex-wrap">
                                    <Skeleton className="w-20 h-4" />
                                    <Skeleton className="w-16 h-4" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default MediaDetailHeaderSkeleton;