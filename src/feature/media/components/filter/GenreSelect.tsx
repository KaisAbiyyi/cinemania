"use client";

import { Button } from "@/components/ui/button";
import { FC, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { useGenres } from "@/feature/genre/hooks/useGenre";

interface Genre {
    id: number;
    name: string;
}

interface GenreSelectProps {
    value?: string;
    onChange?: (value: string) => void;
    mediaType?: "movie" | "tv";
}

const GenreSelect: FC<GenreSelectProps> = ({
    value = "",
    onChange,
    mediaType = "movie",
}) => {
    const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
    const { data: genres, isLoading, error } = useGenres(mediaType);

    /**
     * Handle select/unselect genre
     */
    const toggleGenre = (genreId: number) => {
        let updatedSelectedGenres = [...selectedGenres];
        if (selectedGenres.includes(genreId)) {
            updatedSelectedGenres = updatedSelectedGenres.filter((id) => id !== genreId);
        } else {
            updatedSelectedGenres.push(genreId);
        }
        setSelectedGenres(updatedSelectedGenres);
        onChange?.(updatedSelectedGenres.join(","));
    };

    /**
     * Update state ketika prop `value` berubah
     */
    useEffect(() => {
        if (value) {
            const genreIds = value.split(",").filter(Boolean).map((id) => parseInt(id));
            setSelectedGenres(genreIds);
        } else {
            setSelectedGenres([]);
        }
    }, [value]);

    return (
        <div className="flex flex-col gap-4">
            <Label>Genres:</Label>
            <div className="flex flex-wrap gap-2">
                {isLoading && (
                    <span className="text-sm text-gray-500">Loading genres...</span>
                )}
                {error && (
                    <span className="text-sm text-red-500">Failed to load genres</span>
                )}
                {genres?.map((genre: Genre) => (
                    <Button
                        key={genre.id}
                        onClick={() => toggleGenre(genre.id)}
                        variant={selectedGenres.includes(genre.id) ? "default" : "outline"}
                        className="rounded-full"
                    >
                        {genre.name}
                    </Button>
                ))}
            </div>
        </div>
    );
};

export default GenreSelect;
