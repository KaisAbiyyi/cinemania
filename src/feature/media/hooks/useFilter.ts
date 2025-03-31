"use client";

import { Filters } from "@/types/filters";
import { useState } from "react";

export const useFilters = (initialFilters: Filters) => {
    const [tempFilters, setTempFilters] = useState<Filters>(initialFilters);
    const [appliedFilters, setAppliedFilters] = useState<Filters>(initialFilters);

    const applyFilters = (newFilters: Filters) => {
        setAppliedFilters(newFilters);
    };

    const resetFilters = (defaults: Filters) => {
        setTempFilters(defaults);
        setAppliedFilters(defaults);
    };

    const hasChanged = JSON.stringify(tempFilters) !== JSON.stringify(appliedFilters);

    return { tempFilters, setTempFilters, appliedFilters, setAppliedFilters, applyFilters, resetFilters, hasChanged };
};
