"use client";

import React, { FC, useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from "@/components/ui/select";

// Opsi sort untuk "movie"
const movieSortOptions = [
    { label: "Popularity Descending", value: "popularity.desc" },
    { label: "Popularity Ascending", value: "popularity.asc" },
    { label: "Release Date Descending", value: "release_date.desc" },
    { label: "Release Date Ascending", value: "release_date.asc" },
    { label: "Vote Average Descending", value: "vote_average.desc" },
    { label: "Vote Average Ascending", value: "vote_average.asc" },
];

// Opsi sort untuk "tv" (sesuai gambar yang Anda lampirkan)
const tvSortOptions = [
    { label: "First Air Date Descending", value: "first_air_date.desc" },
    { label: "First Air Date Ascending", value: "first_air_date.asc" },
    { label: "Name Descending", value: "name.desc" },
    { label: "Name Ascending", value: "name.asc" },
    { label: "Original Name Descending", value: "original_name.desc" },
    { label: "Original Name Ascending", value: "original_name.asc" },
    { label: "Popularity Descending", value: "popularity.desc" },
    { label: "Popularity Ascending", value: "popularity.asc" },
    { label: "Vote Average Descending", value: "vote_average.desc" },
    { label: "Vote Average Ascending", value: "vote_average.asc" },
    { label: "Vote Count Descending", value: "vote_count.desc" },
    { label: "Vote Count Ascending", value: "vote_count.asc" },
];

interface SortBySelectProps {
    mediaType: "movie" | "tv";         // Tambahkan prop mediaType
    initialValue?: string;
    onChange?: (value: string) => void;
}

const SortBySelect: FC<SortBySelectProps> = ({
    mediaType,
    initialValue = "popularity.desc",
    onChange,
}) => {
    const [sortBy, setSortBy] = useState(initialValue);

    // Pilih array sortOptions sesuai mediaType
    const sortOptions = mediaType === "tv" ? tvSortOptions : movieSortOptions;

    // Update state jika initialValue berubah (misalnya, saat reset filter)
    useEffect(() => {
        setSortBy(initialValue);
    }, [initialValue]);

    const handleChange = (value: string) => {
        setSortBy(value);
        onChange?.(value);
    };

    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor="sort-by-select">Sort Results By</Label>
            <Select value={sortBy} onValueChange={handleChange}>
                <SelectTrigger id="sort-by-select" className="w-full">
                    <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                    {sortOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
};

export default SortBySelect;
