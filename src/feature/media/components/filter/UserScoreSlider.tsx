"use client";

import { FC, useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

interface UserScoreSliderProps {
    minScore?: number;
    maxScore?: number;
    onChange?: (gte: number, lte: number) => void;
}

const UserScoreSlider: FC<UserScoreSliderProps> = ({
    minScore = 0,
    maxScore = 10,
    onChange,
}) => {
    const [selectedRange, setSelectedRange] = useState<number[]>([minScore, maxScore]);

    const handleChange = (value: number[]) => {
        setSelectedRange(value);
        onChange?.(value[0], value[1]);
    };

    useEffect(() => {
        setSelectedRange([minScore, maxScore]);
    }, [minScore, maxScore]);

    return (
        <div className="flex flex-col gap-4 mb-4">
            <Label>
                User Score: {selectedRange[0]} - {selectedRange[1]}
            </Label>
            <div className="flex justify-between">
                <Label className="text-xs">0</Label>
                <Label className="text-xs">5</Label>
                <Label className="text-xs">10</Label>
            </div>
            <Slider
                value={selectedRange}
                onValueChange={handleChange}
                min={0}
                max={10}
                step={1}
                minStepsBetweenThumbs={1}
            />
        </div>
    );
};

export default UserScoreSlider;
