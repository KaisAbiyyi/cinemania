"use client";

import React, {
    createContext,
    Suspense,
    useCallback,
    useContext,
    useEffect,
    useState,
    useMemo,
    useRef,
    useSyncExternalStore,
    ReactNode,
    FC,
} from "react";
import { useSearchParams } from "next/navigation";
import { Filters, globalDefaultFilters } from "@/types/filters";
import {
    DiscoveryDatePreset,
    parseCalendarDateKey,
    resolveDiscoveryDatePresetFiltersForYmd,
} from "@/lib/datePresets";
import { parseQuery } from "@/lib/utils";
import { MediaQueryParams } from "../../hooks/useMedia";
import { useLocalCalendarDay } from "../../hooks/useLocalCalendarDay";

const emptySubscribe = () => () => {};

const NUMERIC_FILTER_KEYS = new Set<keyof Filters>([
    "vote_average_gte",
    "vote_average_lte",
    "vote_count_gte",
    "with_runtime_gte",
    "with_runtime_lte",
]);

function normalizeParsedUrlFilters(raw: Partial<Filters>): Partial<Filters> {
    const normalized: Partial<Filters> = {};

    (Object.keys(raw) as (keyof Filters)[]).forEach((key) => {
        const value = raw[key];
        if (value === undefined) return;
        if (NUMERIC_FILTER_KEYS.has(key)) {
            const numeric = typeof value === "number" ? value : Number(value);
            if (Number.isFinite(numeric)) {
                (normalized as Record<string, unknown>)[key] = numeric;
            }
            return;
        }
        (normalized as Record<string, unknown>)[key] = value;
    });

    return normalized;
}

function FilterUrlSyncObserver({
    onObservedSearchChange,
}: {
    onObservedSearchChange: (nextSearch: string) => void;
}) {
    const searchParams = useSearchParams();
    const searchKey = searchParams?.toString() ?? "";

    useEffect(() => {
        onObservedSearchChange(searchKey);
    }, [searchKey, onObservedSearchChange]);

    return null;
}

interface FilterContextProps {
    filters: Filters;
    setFilters: (update: Partial<Filters> | ((prev: Filters) => Partial<Filters>)) => void;
    resetFilters: () => void;
    markExpectedUrlSearch?: (nextSearch: string) => void;
    baseDefaultFilters: Filters;
    isReady: boolean;
}

interface FilterProviderProps {
    children: ReactNode;
    defaultFilters?: Filters;
    datePreset?: DiscoveryDatePreset;
}

const FilterContext = createContext<FilterContextProps | undefined>(undefined);

export const FilterProvider: FC<FilterProviderProps> = ({ children, defaultFilters, datePreset }) => {
    const isHydrated = useSyncExternalStore(
        emptySubscribe,
        () => true,
        () => false
    );
    const localCalendarDay = useLocalCalendarDay(Boolean(datePreset));

    const serializedDefaults = JSON.stringify(defaultFilters ?? globalDefaultFilters);

    const staticBaseDefaults = useMemo<Filters>(
        () => JSON.parse(serializedDefaults) as Filters,
        [serializedDefaults]
    );

    const isReady = !datePreset || (isHydrated && Boolean(localCalendarDay));

    const baseDefaultFilters = useMemo<Filters>(() => {
        if (!datePreset || !localCalendarDay) {
            return staticBaseDefaults;
        }
        const ymd = parseCalendarDateKey(localCalendarDay);
        if (!ymd) {
            return staticBaseDefaults;
        }
        return {
            ...staticBaseDefaults,
            ...resolveDiscoveryDatePresetFiltersForYmd(datePreset, ymd),
        };
    }, [staticBaseDefaults, datePreset, localCalendarDay]);

    const initialUrlFilters = useMemo<Partial<Filters>>(() => {
        if (!isHydrated || typeof window === "undefined") {
            return {};
        }
        return normalizeParsedUrlFilters(parseQuery(window.location.search));
    }, [isHydrated]);

    const [externalUrlFilters, setExternalUrlFilters] = useState<Partial<Filters> | null>(null);
    const urlFilters = externalUrlFilters ?? initialUrlFilters;

    const [customOverrides, setCustomOverrides] = useState<Partial<Filters> | null>(null);

    const lastObservedSearchRef = useRef<string | null>(null);
    const expectedInternalSearchRef = useRef<string | null>(null);

    const applyExternalSearch = useCallback((nextSearch: string) => {
        expectedInternalSearchRef.current = null;
        lastObservedSearchRef.current = nextSearch;
        setCustomOverrides(null);
        setExternalUrlFilters(
            normalizeParsedUrlFilters(parseQuery(nextSearch ? `?${nextSearch}` : ""))
        );
    }, []);

    const handleObservedSearchChange = useCallback(
        (nextSearch: string) => {
            if (lastObservedSearchRef.current === null) {
                lastObservedSearchRef.current = nextSearch;
                return;
            }
            if (lastObservedSearchRef.current === nextSearch) {
                return;
            }
            lastObservedSearchRef.current = nextSearch;
            if (
                expectedInternalSearchRef.current !== null &&
                nextSearch === expectedInternalSearchRef.current
            ) {
                expectedInternalSearchRef.current = null;
                return;
            }
            applyExternalSearch(nextSearch);
        },
        [applyExternalSearch]
    );

    const markExpectedUrlSearch = useCallback((nextSearch: string) => {
        const normalizedSearch = nextSearch.replace(/^\?/, "");
        if (lastObservedSearchRef.current === normalizedSearch) {
            expectedInternalSearchRef.current = null;
            return;
        }
        expectedInternalSearchRef.current = normalizedSearch;
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const handlePopState = () => {
            const nextSearch = window.location.search.replace(/^\?/, "");
            if (lastObservedSearchRef.current === nextSearch && customOverrides === null && externalUrlFilters === null) {
                return;
            }
            applyExternalSearch(nextSearch);
        };
        window.addEventListener("popstate", handlePopState);
        return () => {
            window.removeEventListener("popstate", handlePopState);
        };
    }, [applyExternalSearch, customOverrides, externalUrlFilters]);

    const activeOverrides = customOverrides ?? urlFilters;

    const filters = useMemo<Filters>(
        () => ({ ...baseDefaultFilters, ...activeOverrides }),
        [baseDefaultFilters, activeOverrides]
    );

    const setFilters = useCallback(
        (update: Partial<Filters> | ((prev: Filters) => Partial<Filters>)) => {
            setCustomOverrides((prev) => {
                const baseOverrides = prev ?? urlFilters;
                const currentFilters: Filters = { ...baseDefaultFilters, ...baseOverrides };
                const updateObj = typeof update === "function" ? update(currentFilters) : update;

                const baseKeys = Object.keys(baseDefaultFilters) as (keyof Filters)[];
                const isFullSnapshot = baseKeys.every((key) => key in updateObj);

                if (!isFullSnapshot) {
                    return { ...baseOverrides, ...updateObj };
                }

                const nextOverrides: Partial<Filters> = {};
                (Object.keys(updateObj) as (keyof Filters)[]).forEach((key) => {
                    const nextValue = updateObj[key];
                    const prevValue = currentFilters[key];
                    const baseValue = baseDefaultFilters[key];
                    const hadExplicitOverride = Object.prototype.hasOwnProperty.call(baseOverrides, key);

                    if (nextValue !== prevValue) {
                        const isUnsetNonPreset =
                            baseValue === undefined && (nextValue === undefined || nextValue === "");
                        if (!isUnsetNonPreset && nextValue !== baseValue) {
                            (nextOverrides as Record<string, unknown>)[key] = nextValue;
                        }
                    } else if (hadExplicitOverride) {
                        (nextOverrides as Record<string, unknown>)[key] = baseOverrides[key];
                    }
                });
                return nextOverrides;
            });
        },
        [baseDefaultFilters, urlFilters]
    );

    const resetFilters = useCallback(() => {
        setCustomOverrides(null);
        setExternalUrlFilters({});
    }, []);

    return (
        <FilterContext.Provider
            value={{
                filters,
                setFilters,
                resetFilters,
                markExpectedUrlSearch,
                baseDefaultFilters,
                isReady,
            }}
        >
            <Suspense fallback={null}>
                <FilterUrlSyncObserver onObservedSearchChange={handleObservedSearchChange} />
            </Suspense>
            {children}
        </FilterContext.Provider>
    );
};

export const useFilterContext = (): FilterContextProps => {
    const context = useContext(FilterContext);
    if (!context) {
        throw new Error("useFilterContext must be used within a FilterProvider");
    }
    return context;
};

// Fungsi bantu untuk convert filter -> query param
export const buildMediaQueryParams = (
    mediaType: "movie" | "tv",
    filters: Filters
): MediaQueryParams => {
    return {
        mediaType,
        sort_by: filters.sort_by || "popularity.desc",
        "release_date.gte": filters.release_date_gte || "",
        "release_date.lte": filters.release_date_lte || "",
        "first_air_date.gte": filters.first_air_date_gte || "",
        "first_air_date.lte": filters.first_air_date_lte || "",
        "air_date.gte": filters.air_date_gte || "",
        "air_date.lte": filters.air_date_lte || "",
        with_genres: filters.with_genres || "",
        "vote_average.gte": filters.vote_average_gte || 0,
        "vote_average.lte": filters.vote_average_lte || 10,
        "vote_count.gte": filters.vote_count_gte || 0,
        "with_runtime.gte": filters.with_runtime_gte || 0,
        "with_runtime.lte": filters.with_runtime_lte || 360,
        with_release_type: filters.with_release_type || "",
        without_genres: filters.without_genres || "",
        with_keywords: filters.with_keywords || "",
        with_original_language: filters.with_original_language || "",
        watch_region: filters.watch_region || "US",
        with_watch_providers: filters.with_watch_providers || "",
    };
};
