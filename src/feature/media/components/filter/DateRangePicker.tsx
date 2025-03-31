"use client";

import React, { FC, useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";

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
    const [startDate, setStartDate] = useState<Date | undefined>(
        initialStartDate ? new Date(initialStartDate) : undefined
    );
    const [endDate, setEndDate] = useState<Date | undefined>(
        initialEndDate ? new Date(initialEndDate) : undefined
    );

    // Ref untuk menyimpan nilai formatted sebelumnya
    const prevFormattedRef = useRef<{ start: string; end: string }>({ start: "", end: "" });

    // Update state saat nilai awal berubah
    useEffect(() => {
        setStartDate(initialStartDate ? new Date(initialStartDate) : undefined);
    }, [initialStartDate]);

    useEffect(() => {
        setEndDate(initialEndDate ? new Date(initialEndDate) : undefined);
    }, [initialEndDate]);

    // Panggil onChange hanya jika nilai formatted berbeda dari sebelumnya
    useEffect(() => {
        if (onChange) {
            const formattedStart = startDate ? format(startDate, "yyyy-MM-dd") : "";
            const formattedEnd = endDate ? format(endDate, "yyyy-MM-dd") : "";
            if (
                formattedStart !== prevFormattedRef.current.start ||
                formattedEnd !== prevFormattedRef.current.end
            ) {
                prevFormattedRef.current = { start: formattedStart, end: formattedEnd };
                onChange(formattedStart, formattedEnd);
            }
        }
    }, [startDate, endDate, onChange]);

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
                        <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus />
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
                        <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus />
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
};

export default DateRangePicker;
