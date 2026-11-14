"use client";

import React, { FC, useState, useEffect } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { parseCalendarDateKey } from "@/lib/datePresets";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";

function parseDateInputValue(value?: string): Date | undefined {
    if (!value) {
        return undefined;
    }
    const ymd = parseCalendarDateKey(value);
    if (ymd) {
        return new Date(ymd.year, ymd.month - 1, ymd.day);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

interface DateRangePickerProps {
    label?: string;
    initialStartDate?: string; // format: YYYY-MM-DD
    initialEndDate?: string;   // format: YYYY-MM-DD
    onChange?: (startDate: string, endDate: string) => void;
}

const DateRangePicker: FC<DateRangePickerProps> = ({
    label = "Release Date Range",
    initialStartDate = "",
    initialEndDate = "",
    onChange,
}) => {
    const [startDate, setStartDate] = useState<Date | undefined>(() =>
        parseDateInputValue(initialStartDate)
    );
    const [endDate, setEndDate] = useState<Date | undefined>(() =>
        parseDateInputValue(initialEndDate)
    );

    // Sync local picker state when defaults or committed filter values change without firing user edits
    useEffect(() => {
        setStartDate(parseDateInputValue(initialStartDate));
    }, [initialStartDate]);

    useEffect(() => {
        setEndDate(parseDateInputValue(initialEndDate));
    }, [initialEndDate]);

    const handleStartSelect = (nextStart: Date | undefined) => {
        setStartDate(nextStart);
        onChange?.(
            nextStart ? format(nextStart, "yyyy-MM-dd") : "",
            endDate ? format(endDate, "yyyy-MM-dd") : ""
        );
    };

    const handleEndSelect = (nextEnd: Date | undefined) => {
        setEndDate(nextEnd);
        onChange?.(
            startDate ? format(startDate, "yyyy-MM-dd") : "",
            nextEnd ? format(nextEnd, "yyyy-MM-dd") : ""
        );
    };

    return (
        <div className="flex flex-col gap-2">
            {label && <Label>{label}</Label>}
            <div className="flex flex-wrap gap-4 items-center">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className={cn(
                                "flex-grow justify-start text-left font-normal",
                                !startDate && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {startDate ? format(startDate, "PPP") : <span>Pick a start date</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={startDate}
                            defaultMonth={startDate}
                            onSelect={handleStartSelect}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className={cn(
                                "flex-grow justify-start text-left font-normal",
                                !endDate && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {endDate ? format(endDate, "PPP") : <span>Pick an end date</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={endDate}
                            defaultMonth={endDate}
                            onSelect={handleEndSelect}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
};

export default DateRangePicker;
