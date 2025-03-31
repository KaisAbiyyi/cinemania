"use client";

import { FC, useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

interface RuntimeRangeSliderProps {
    minValue?: number;
    maxValue?: number;
    onChange?: (min: number, max: number) => void;
}

const RuntimeRangeSlider: FC<RuntimeRangeSliderProps> = ({
    minValue = 0,
    maxValue = 360,
    onChange,
}) => {
    const [selectedRange, setSelectedRange] = useState<number[]>([minValue, maxValue]);

    useEffect(() => {
        setSelectedRange([minValue, maxValue]);
    }, [minValue, maxValue]);

    const handleChange = (value: number[]) => {
        setSelectedRange(value);
        onChange?.(value[0], value[1]);
    };

    return (
        <div className="flex flex-col gap-4">
            <Label>
                Runtime (Minutes): {selectedRange[0]} - {selectedRange[1]}
            </Label>
            <div className="flex justify-between">
                <Label className="text-xs">0</Label>
                <Label className="text-xs">120</Label>
                <Label className="text-xs">140</Label>
                <Label className="text-xs">360</Label>
            </div>
            <Slider
                value={selectedRange}
                onValueChange={handleChange}
                min={0}
                max={360}
                step={15}
                minStepsBetweenThumbs={1}
            />
        </div>
    );
};

export default RuntimeRangeSlider;
