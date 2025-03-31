"use client";

import * as React from "react";
import { FC, useState, useEffect, useMemo } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Command,
    CommandInput,
    CommandList,
    CommandGroup,
    CommandItem,
    CommandEmpty,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguages } from "@/feature/languages/hooks/useLanguages";

interface Language {
    iso_639_1: string;
    english_name: string;
    name: string;
}

interface LanguageSelectProps {
    initialValue?: string;
    onChange?: (value: string) => void;
    label?: string;
}

const LanguageSelect: FC<LanguageSelectProps> = ({
    initialValue = "en",
    onChange,
    label = "Language",
}) => {
    const { data: languages, isLoading } = useLanguages();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState(initialValue);
    const [searchQuery, setSearchQuery] = useState("");

    // Update state value jika initialValue berubah
    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const handleSelect = (lang: Language) => {
        setValue(lang.iso_639_1);
        onChange?.(lang.iso_639_1);
        setOpen(false);
    };

    return (
        <div className="flex flex-col gap-2">
            {label && <Label htmlFor="language-select">{label}</Label>}
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="justify-between"
                    >
                        {value
                            ? languages?.find((l: Language) => l.iso_639_1 === value)?.english_name
                            : "Select language..."}
                        <ChevronsUpDown className="opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                    <Command>
                        <CommandInput
                            placeholder="Search language..."
                        />
                        <CommandList>
                            {isLoading && <CommandEmpty>Loading...</CommandEmpty>}
                            {!isLoading && languages?.length === 0 && (
                                <CommandEmpty>No language found.</CommandEmpty>
                            )}
                            <CommandGroup>
                                {languages?.map((lang: Language) => (
                                    <CommandItem
                                        key={lang.iso_639_1}
                                        value={lang.english_name}
                                        onSelect={() => handleSelect(lang)}
                                    >
                                        {lang.english_name}
                                        {lang.name ? ` (${lang.name})` : ""}
                                        <Check
                                            className={cn(
                                                "ml-auto",
                                                value === lang.iso_639_1 ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
};

export default LanguageSelect;
