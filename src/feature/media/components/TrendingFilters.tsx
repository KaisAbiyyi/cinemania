"use client";

import { FC } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { LayoutGrid, StretchHorizontal } from "lucide-react";
import { useTrendingFilters } from "../hooks/useTrendingFilters";

const TrendingFilters: FC = () => {
    const { 
        mediaType, 
        setMediaType, 
        timeWindow, 
        setTimeWindow, 
        orientation, 
        setOrientation 
    } = useTrendingFilters();

    return (
        <div className="flex justify-between">
            <div className="flex gap-4">
                <Select 
                    value={mediaType} 
                    onValueChange={(value) => setMediaType(value as "all" | "movie" | "tv")}
                >
                    <SelectTrigger className="w-[125px]">
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
                    onValueChange={(value) => setTimeWindow(value as "day" | "week")}
                >
                    <SelectTrigger className="w-[125px]">
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
                <SelectTrigger>
                    <SelectValue placeholder={orientation === "horizontal" ? <LayoutGrid /> : <StretchHorizontal />} />
                </SelectTrigger>
                <SelectContent>
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