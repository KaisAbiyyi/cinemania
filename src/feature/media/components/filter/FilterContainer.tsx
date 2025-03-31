"use client";

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { LayoutGrid, StretchHorizontal } from "lucide-react";
import { FC, useEffect, useMemo, useState } from "react";

// Import komponen filter individual
import DateRangePicker from "./DateRangePicker";
import GenreSelect from "./GenreSelect";
import KeywordsFilter from "./KeywordsFilter";
import RuntimeRangeSlider from "./RuntimeRangeSlider";
import SortBySelect from "./SortBySelect";
import UserScoreSlider from "./UserScoreSlider";
import VotesSlider from "./VotesSlider";

// Import custom hooks
import { useFilterSync } from "../../hooks/useFilterSync";

// Import tipe dan default global
import { Filters, globalDefaultFilters } from "@/types/filters";

// Import Zustand store untuk orientation
import { useTrendingFilters } from "../../hooks/useTrendingFilters";
import { useFilterContext } from "./FilterProvider";
import LanguageSelect from "./LanguageSelect";
import WatchProvidersFilter from "./WatchProvidersFilter";
import { usePathname, useRouter } from "next/navigation";

interface FilterContainerProps {
    mediaType: "movie" | "tv";
    onApply?: (filters: Filters) => void;
    onOrientationChange?: (orientation: "horizontal" | "vertical") => void;
}

const FilterContainer: FC<FilterContainerProps> = ({
    mediaType,
    onApply,
    onOrientationChange,
}) => {
    const { filters: globalFilters, setFilters, resetFilters, baseDefaultFilters } = useFilterContext();
    const router = useRouter();
    const pathname = usePathname();

    // Gunakan baseDefaultFilters sebagai nilai default
    const { updateUrl } = useFilterSync(baseDefaultFilters);

    // State lokal untuk filter sementara
    const [tempFilters, setTempFilters] = useState<Filters>(globalFilters);
    useEffect(() => {
        // Saat mount atau ketika globalFilters berubah (misal reset), update state lokal
        setTempFilters(globalFilters);
    }, [globalFilters]);

    // State lokal untuk toggle filter tanggal (khusus TV)
    const [activeDateFilter, setActiveDateFilter] = useState<"air_date" | "first_air_date">("air_date");

    useEffect(() => {
        if (mediaType === "tv") {
            const hasFirstAirDate =
                (tempFilters.first_air_date_gte ?? "") !== "" ||
                (tempFilters.first_air_date_lte ?? "") !== "";
            const newActiveDateFilter = hasFirstAirDate ? "first_air_date" : "air_date";
            if (activeDateFilter !== newActiveDateFilter) {
                setActiveDateFilter(newActiveDateFilter);
            }
        }
    }, [mediaType, tempFilters, activeDateFilter]);

    // Hitung apakah reset tersedia dengan membandingkan globalFilters dengan baseDefaultFilters
    const resetAvailable = useMemo(
        () => JSON.stringify(globalFilters) !== JSON.stringify(baseDefaultFilters),
        [globalFilters, baseDefaultFilters]
    );

    const handleApply = () => {
        setFilters(tempFilters);
        onApply?.(tempFilters);

        let finalFilters = { ...tempFilters };

        if (mediaType === "tv") {
            if (activeDateFilter === "first_air_date") {
                delete finalFilters.air_date_gte;
                delete finalFilters.air_date_lte;
            } else {
                delete finalFilters.first_air_date_gte;
                delete finalFilters.first_air_date_lte;
            }
        }

        const cleanedFilters: Partial<Filters> = {};
        const dateKeys = new Set([
            "release_date_gte",
            "release_date_lte",
            "air_date_gte",
            "air_date_lte",
            "first_air_date_gte",
            "first_air_date_lte",
        ]);
        Object.entries(finalFilters).forEach(([key, val]) => {
            if (val === undefined || val === "") return;
            const typedKey = key as keyof Filters;
            if (dateKeys.has(typedKey as string) && typeof val === "string" && val.trim() !== "") {
                cleanedFilters[typedKey] = new Date(val).toISOString();
            } else {
                cleanedFilters[typedKey] = val;
            }
        });

        updateUrl(cleanedFilters);
        console.log("Applied filters:", cleanedFilters);
    };

    const handleReset = () => {
        resetFilters(); // Reset state di context ke baseDefaultFilters
        setTempFilters(baseDefaultFilters);
        updateUrl(baseDefaultFilters);
        router.push(pathname);
    };

    const { orientation, setOrientation } = useTrendingFilters();
    const handleOrientationChange = (value: "horizontal" | "vertical") => {
        setOrientation(value);
        onOrientationChange?.(value);
    };

    return (
        <Accordion type="single" collapsible>
            <AccordionItem value="item-1">
                <div className="flex justify-between items-center">
                    <AccordionTrigger
                        className={buttonVariants({
                            variant: "outline",
                            className: "hover:no-underline bg-transparent",
                        })}
                    >
                        Filter
                    </AccordionTrigger>
                    <Select
                        value={orientation}
                        onValueChange={(value) => handleOrientationChange(value as "horizontal" | "vertical")}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder={<LayoutGrid />} />
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
                <AccordionContent className="mt-5">
                    <Card className="flex flex-col items-end gap-4 md:gap-6 lg:gap-8 p-4 md:p-6 lg:p-8 transition-all duration-75 ease-in">
                        <div className="flex gap-4 md:gap-6 lg:gap-8 flex-col md:flex-row transition-all duration-75 ease-in">
                            {/* Bagian kiri */}
                            <CardContent className="flex flex-col p-0 gap-4 md:gap-6 lg:gap-8 w-full md:w-1/2 transition-all duration-75 ease-in">
                                <SortBySelect
                                    mediaType={mediaType}
                                    initialValue={tempFilters.sort_by}
                                    onChange={(value) =>
                                        setTempFilters((prev) => ({ ...prev, sort_by: value }))
                                    }
                                />
                                {mediaType === "tv" && (
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant={activeDateFilter === "air_date" ? "default" : "outline"}
                                            onClick={() => {
                                                if (activeDateFilter !== "air_date") {
                                                    setTempFilters((prev) => ({
                                                        ...prev,
                                                        air_date_gte: prev.first_air_date_gte || prev.air_date_gte,
                                                        air_date_lte: prev.first_air_date_lte || prev.air_date_lte,
                                                        first_air_date_gte: undefined,
                                                        first_air_date_lte: undefined,
                                                    }));
                                                    setActiveDateFilter("air_date");
                                                }
                                            }}
                                        >
                                            Air Date
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={activeDateFilter === "first_air_date" ? "default" : "outline"}
                                            onClick={() => {
                                                if (activeDateFilter !== "first_air_date") {
                                                    setTempFilters((prev) => ({
                                                        ...prev,
                                                        first_air_date_gte: prev.air_date_gte || prev.first_air_date_gte,
                                                        first_air_date_lte: prev.air_date_lte || prev.first_air_date_lte, // sudah diperbaiki
                                                        air_date_gte: undefined,
                                                        air_date_lte: undefined,
                                                    }));
                                                    setActiveDateFilter("first_air_date");
                                                }
                                            }}
                                        >
                                            First Air Date
                                        </Button>

                                    </div>
                                )}
                                <DateRangePicker
                                    initialStartDate={
                                        mediaType === "tv"
                                            ? (tempFilters[`${activeDateFilter}_gte`] as string)
                                            : tempFilters.release_date_gte
                                    }
                                    initialEndDate={
                                        mediaType === "tv"
                                            ? (tempFilters[`${activeDateFilter}_lte`] as string)
                                            : tempFilters.release_date_lte
                                    }
                                    onChange={(start, end) =>
                                        setTempFilters((prev) => {
                                            if (mediaType === "tv") {
                                                const gteKey = `${activeDateFilter}_gte` as keyof Filters;
                                                const lteKey = `${activeDateFilter}_lte` as keyof Filters;
                                                return { ...prev, [gteKey]: start, [lteKey]: end };
                                            } else {
                                                return { ...prev, release_date_gte: start, release_date_lte: end };
                                            }
                                        })
                                    }
                                />
                                <Accordion type="single" collapsible>
                                    <AccordionItem value="item-1">
                                        <AccordionTrigger
                                            className={buttonVariants({
                                                variant: "outline",
                                                className: "hover:no-underline justify-between bg-transparent",
                                            })}
                                        >
                                            Where to Watch
                                        </AccordionTrigger>
                                        <AccordionContent className="mt-5">
                                            <WatchProvidersFilter
                                                mediaType={mediaType}
                                                initialWatchRegion={tempFilters.watch_region}
                                                initialProviders={tempFilters.with_watch_providers}
                                                onChange={(watch_region, with_watch_providers) =>
                                                    setTempFilters((prev) => ({
                                                        ...prev,
                                                        watch_region,
                                                        with_watch_providers,
                                                    }))
                                                }
                                            />
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            </CardContent>
                            {/* Bagian kanan */}
                            <CardContent className="flex flex-col p-0 gap-4 md:gap-6 lg:gap-8 w-full md:w-1/2 transition-all duration-75 ease-in">
                                <GenreSelect
                                    value={tempFilters.with_genres}
                                    onChange={(value) => setTempFilters((prev) => ({ ...prev, with_genres: value }))}
                                    mediaType={mediaType}
                                />
                                <LanguageSelect
                                    initialValue={tempFilters.with_original_language as string}
                                    onChange={(value) =>
                                        setTempFilters((prev) => ({ ...prev, with_original_language: value }))
                                    }
                                />
                                <UserScoreSlider
                                    minScore={tempFilters.vote_average_gte}
                                    maxScore={tempFilters.vote_average_lte}
                                    onChange={(gte, lte) =>
                                        setTempFilters((prev) => ({
                                            ...prev,
                                            vote_average_gte: gte,
                                            vote_average_lte: lte,
                                        }))
                                    }
                                />
                                <VotesSlider
                                    value={tempFilters.vote_count_gte}
                                    onChange={(value) =>
                                        setTempFilters((prev) => ({ ...prev, vote_count_gte: value }))
                                    }
                                />
                                <RuntimeRangeSlider
                                    minValue={tempFilters.with_runtime_gte}
                                    maxValue={tempFilters.with_runtime_lte}
                                    onChange={(min, max) =>
                                        setTempFilters((prev) => ({
                                            ...prev,
                                            with_runtime_gte: min,
                                            with_runtime_lte: max,
                                        }))
                                    }
                                />
                                <KeywordsFilter
                                    value={tempFilters.with_keywords}
                                    onChange={(value) =>
                                        setTempFilters((prev) => ({ ...prev, with_keywords: value }))
                                    }
                                    label="Keywords"
                                />
                            </CardContent>
                        </div>
                        <CardContent className="flex gap-2">
                            {resetAvailable && (
                                <Button variant="outline" onClick={handleReset}>
                                    Reset
                                </Button>
                            )}
                            <Button variant="default" onClick={handleApply}>
                                Apply
                            </Button>
                        </CardContent>
                    </Card>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    );
};

export default FilterContainer;
