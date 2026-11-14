"use client";

import { FC, Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { LayoutGrid, StretchHorizontal } from "lucide-react";
import { useTrendingFilters } from "../../hooks/useTrendingFilters";

function normalizeTrendingMediaType(value: string | null): "all" | "movie" | "tv" {
    if (value === "movie" || value === "tv") return value;
    return "all";
}

function normalizeTrendingTimeWindow(value: string | null): "day" | "week" {
    if (value === "day") return "day";
    return "week";
}

function buildTrendingSearch(mediaType: "all" | "movie" | "tv", timeWindow: "day" | "week"): string {
    const params = new URLSearchParams();
    if (mediaType !== "all") params.set("mediaType", mediaType);
    if (timeWindow !== "week") params.set("timeWindow", timeWindow);
    return params.toString();
}

const TrendingUrlSync: FC<{ expectedSearchRef: React.MutableRefObject<string | null> }> = ({
    expectedSearchRef,
}) => {
    const searchParams = useSearchParams();
    const searchKey = searchParams?.toString() ?? "";
    const lastSearchRef = useRef<string | null>(null);
    const { setMediaType, setTimeWindow } = useTrendingFilters();

    useEffect(() => {
        const isInitial = lastSearchRef.current === null;
        if (!isInitial && lastSearchRef.current === searchKey) {
            return;
        }
        lastSearchRef.current = searchKey;

        if (!isInitial && expectedSearchRef.current !== null && searchKey === expectedSearchRef.current) {
            expectedSearchRef.current = null;
            return;
        }
        expectedSearchRef.current = null;

        setMediaType(normalizeTrendingMediaType(searchParams?.get("mediaType") ?? null));
        setTimeWindow(normalizeTrendingTimeWindow(searchParams?.get("timeWindow") ?? null));
    }, [searchKey, searchParams, expectedSearchRef, setMediaType, setTimeWindow]);

    return null;
};

const TrendingFilters: FC = () => {
    const router = useRouter();
    const pathname = usePathname();
    const expectedSearchRef = useRef<string | null>(null);
    const {
        mediaType,
        setMediaType,
        timeWindow,
        setTimeWindow,
        orientation,
        setOrientation
    } = useTrendingFilters();

    const syncUrl = (nextMediaType: "all" | "movie" | "tv", nextTimeWindow: "day" | "week") => {
        const nextSearch = buildTrendingSearch(nextMediaType, nextTimeWindow);
        expectedSearchRef.current = nextSearch;
        router.push(nextSearch ? `${pathname}?${nextSearch}` : pathname);
    };

    return (
        <div className="flex justify-between">
            <Suspense fallback={null}>
                <TrendingUrlSync expectedSearchRef={expectedSearchRef} />
            </Suspense>
            <div className="flex gap-4">
                <Select
                    value={mediaType}
                    onValueChange={(value) => {
                        const next = value as "all" | "movie" | "tv";
                        setMediaType(next);
                        syncUrl(next, timeWindow);
                    }}
                >
                    <SelectTrigger aria-label="Trending media type" className="w-[125px]">
                        <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="movie">Movies</SelectItem>
                        <SelectItem value="tv">TV Shows</SelectItem>
                    </SelectContent>
                </Select>
                <Select
                    value={timeWindow}
                    onValueChange={(value) => {
                        const next = value as "day" | "week";
                        setTimeWindow(next);
                        syncUrl(mediaType, next);
                    }}
                >
                    <SelectTrigger aria-label="Trending time window" className="w-[125px]">
                        <SelectValue placeholder="Week" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="day">Day</SelectItem>
                        <SelectItem value="week">Week</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <Select
                value={orientation}
                onValueChange={(value) => setOrientation(value as "horizontal" | "vertical")}
            >
                <SelectTrigger aria-label="Layout orientation">
                    <SelectValue placeholder={orientation === "horizontal" ? <LayoutGrid /> : <StretchHorizontal />} />
                </SelectTrigger>
                <SelectContent align="end">
                    <SelectItem value="horizontal">
                        <LayoutGrid />
                    </SelectItem>
                    <SelectItem value="vertical">
                        <StretchHorizontal />
                    </SelectItem>
                </SelectContent>
            </Select>
        </div>
    );
};

export default TrendingFilters;