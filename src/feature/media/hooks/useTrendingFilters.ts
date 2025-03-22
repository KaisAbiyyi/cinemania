"use client";

import { create } from "zustand";

// Define the specific types that match what's expected by your components
type MediaType = "all" | "movie" | "tv";
type TimeWindow = "day" | "week";
type Orientation = "horizontal" | "vertical";

type TrendingFiltersState = {
    mediaType: MediaType;
    setMediaType: (mediaType: MediaType) => void;
    timeWindow: TimeWindow;
    setTimeWindow: (timeWindow: TimeWindow) => void;
    orientation: Orientation;
    setOrientation: (orientation: Orientation) => void;
};

export const useTrendingFilters = create<TrendingFiltersState>((set) => ({
    mediaType: "all",
    setMediaType: (mediaType) => set({ mediaType }),
    timeWindow: "week",
    setTimeWindow: (timeWindow) => set({ timeWindow }),
    orientation: "horizontal",
    setOrientation: (orientation) => set({ orientation }),
}));