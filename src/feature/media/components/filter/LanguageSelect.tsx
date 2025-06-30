"use client";

import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguages } from "@/feature/languages/hooks/useLanguages";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { FC, useEffect, useState } from "react";

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
