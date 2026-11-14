"use client"

import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { useTrending } from "@/feature/media/hooks/useTrending";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { FC, Suspense } from "react";
import { HeroCarouselProvider } from "../hooks/HeroCarouselProvider";
import HeroBackground from "./HeroBackground";
import HeroMovieInfo from "./HeroMediaInfo";
import HeroMiniCarousel from "./HeroMiniCarousel";
import HeroScrollButton from "./HeroScrollButton";
import HeroSearchBar from "./HeroSearchBar";
import HeroSectionSkeleton from "./HeroSectionSkeleton";

const HeroSection: FC = () => {
    const { data, isLoading, error, refetch } = useTrending({
        mediaType: "all",
        timeWindow: "week",
        language: "en-US",
    });

    if (isLoading) {
        return (
            <div role="status" aria-label="Loading featured trending media">
                <HeroSectionSkeleton />
            </div>
        );
    }
    if (error) {
        return (
            <ErrorState
                message={error.message || "Failed to load featured media."}
                onRetry={() => void refetch()}
            />
        );
    }
    if (!data || !data.results || data.results.length === 0) {
        return (
            <EmptyState
                title="No featured titles"
                message="No featured trending titles are available right now."
            />
        );
    }


    // Mengambil array media dari properti results pada response
    const trendingMedia = data.results.slice(0, 5);

    return (
        <HeroCarouselProvider moviesLength={trendingMedia.length}>
            <Card className="relative flex flex-col overflow-hidden p-0 gap-0">
                <div className="relative">
                    <HeroBackground movies={trendingMedia} />
                    <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-indigo-950 to-indigo/10 p-4">
                        <div className="absolute lg:hidden top-1/2 -translate-y-1/2 flex justify-between right-0 left-0">
                            <HeroScrollButton direction="prev" />
                            <HeroScrollButton direction="next" />
                        </div>
                        <CardHeader className="flex flex-row justify-end p-0">
                            <Link
                                href="/trending"
                                className={buttonVariants({
                                    variant: "secondary",
                                    className: "w-fit",
                                })}
                            >
                                More
                                <ChevronRight />
                            </Link>
                        </CardHeader>
                        <CardHeader className="md:items-end md:justify-between lg:flex-row p-0">
                            <HeroMovieInfo media={trendingMedia} />
                            <HeroMiniCarousel media={trendingMedia} />
                        </CardHeader>
                    </div>
                </div>
                <Suspense fallback={<div className="h-[68px] bg-indigo-950" aria-hidden="true" />}>
                    <HeroSearchBar />
                </Suspense>
            </Card>
        </HeroCarouselProvider>
    );
};

export default HeroSection;
