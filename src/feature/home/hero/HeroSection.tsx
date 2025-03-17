"use client"

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import HeroBackground from "./HeroBackground";
import { ChevronRight, Search } from "lucide-react";
import { FC } from "react";
import HeroMovieInfo from "./HeroMediaInfo";
import HeroMiniCarousel from "./HeroMiniCarousel";
import HeroSectionSkeleton from "./HeroSectionSkeleton";
import { HeroCarouselProvider } from "../hooks/HeroCarouselProvider";
import Link from "next/link";
import { useTrending } from "@/feature/media/hooks/useTrending";
import HeroScrollButton from "./HeroScrollButton";
import { Input } from "@/components/ui/input";
import HeroSearchBar from "./HeroSearchBar";

const HeroSection: FC = () => {
    const { data, isLoading, error } = useTrending({
        mediaType: "all",
        timeWindow: "week",
        language: "en-US",
    });

    if (isLoading) return <HeroSectionSkeleton />;
    if (error || !data || data.results.length === 0)
        return <h1>Failed to load movies.</h1>;

    // Mengambil array media dari properti results pada response
    const trendingMedia = data.results.slice(0, 5);

    return (
        <HeroCarouselProvider moviesLength={trendingMedia.length}>
            <Card className="relative flex flex-col overflow-hidden p-0 gap-0">
                <div className="relative">
                    <HeroBackground movies={trendingMedia} />
                    <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-indigo-950 to-slate-indigo/10 p-4">
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
                <HeroSearchBar />
            </Card>
        </HeroCarouselProvider>
    );
};

export default HeroSection;
