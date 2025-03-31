"use client";

import { Slider } from "@/components/ui/slider";
import { FC, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";

interface UserVoteSliderProps {
    value?: number;
    onChange?: (value: number) => void;
}

const VotesSlider: FC<UserVoteSliderProps> = ({ value = 0, onChange }) => {
    const [voteCount, setVoteCount] = useState<number>(value);

    const handleChange = (value: number[]) => {
        const newValue = value[0];
        setVoteCount(newValue);
        onChange?.(newValue);
    };

    useEffect(() => {
        setVoteCount(value);
    }, [value]);

    return (
        <div className="flex flex-col gap-4">
            <Label>
                Minimum User Votes: {voteCount}
            </Label>
            <div className="flex justify-between">
                <Label className="text-xs">0</Label>
                <Label className="text-xs">100</Label>
                <Label className="text-xs">200</Label>
                <Label className="text-xs">300</Label>
                <Label className="text-xs">400</Label>
                <Label className="text-xs">500</Label>
            </div>
            <Slider
                value={[voteCount]}
                onValueChange={handleChange}
                min={0}
                max={500}
                step={50}
                className="flex-1"
            />
        </div>
    );
};

export default VotesSlider;
