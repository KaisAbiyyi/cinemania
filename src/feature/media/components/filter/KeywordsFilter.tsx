"use client";

import { FC, useState, useEffect, useMemo } from "react";
import {
    Command,
    CommandInput,
    CommandList,
    CommandItem,
    CommandGroup,
    CommandEmpty,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { useKeywordsSearch } from "@/feature/keywords/hooks/useKeywords";
import { Label } from "@/components/ui/label";

interface KeywordsFilterProps {
    value?: string; // berisi kumpulan keyword (ID) dalam format misal "1,2,3"
    onChange?: (value: string) => void;
    label?: string;
}

export interface KeywordItem {
    id: number;
    name: string;
}

const KeywordsFilter: FC<KeywordsFilterProps> = ({
    value = "",
    onChange,
    label = "Keywords",
}) => {
    // State untuk input pencarian
    const [searchQuery, setSearchQuery] = useState("");
    // State untuk menyimpan keyword IDs dari props value
    const [keywordIds, setKeywordIds] = useState<number[]>([]);
    // State untuk menyimpan nama keyword yang berhasil di-fetch
    const [keywordNames, setKeywordNames] = useState<Record<number, string>>({});

    // Parse nilai value saat pertama kali mount atau saat value berubah
    useEffect(() => {
        if (!value) {
            setKeywordIds([]);
            return;
        }

        const ids = value.split(",").filter(Boolean).map(Number);
        setKeywordIds(ids);
    }, [value]);

    // Menggunakan hook useKeywordsSearch untuk mengambil data keyword dari API
    const { data: keywordResponse, isLoading } = useKeywordsSearch({ query: searchQuery });
    const suggestions = keywordResponse?.results || [];

    // Ambil semua keyword untuk lookup
    const { data: allKeywordsResponse } = useKeywordsSearch({
        query: "",  // Empty query to get all keywords
    }, {
        enabled: keywordIds.length > 0, // Only fetch if we have keywords to display
    });

    // Update keywordNames saat data allKeywords tersedia
    useEffect(() => {
        if (!allKeywordsResponse?.results) return;

        const newKeywordNames = { ...keywordNames };
        let hasChanges = false;

        allKeywordsResponse.results.forEach(keyword => {
            if (keywordIds.includes(keyword.id) && !newKeywordNames[keyword.id]) {
                newKeywordNames[keyword.id] = keyword.name;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            setKeywordNames(newKeywordNames);
        }
    }, [allKeywordsResponse, keywordIds]);

    // Update keywordNames dari suggestions juga
    useEffect(() => {
        if (!suggestions.length) return;

        const newKeywordNames = { ...keywordNames };
        let hasChanges = false;

        suggestions.forEach(keyword => {
            if (keywordIds.includes(keyword.id) && !newKeywordNames[keyword.id]) {
                newKeywordNames[keyword.id] = keyword.name;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            setKeywordNames(newKeywordNames);
        }
    }, [suggestions, keywordIds]);

    // Fungsi untuk menambahkan keyword
    const addKeyword = (keyword: KeywordItem) => {
        if (keywordIds.includes(keyword.id)) return;

        const newIds = [...keywordIds, keyword.id];
        setKeywordIds(newIds);

        // Update keywordNames
        setKeywordNames(prev => ({
            ...prev,
            [keyword.id]: keyword.name
        }));

        onChange?.(newIds.join(","));
    };

    // Fungsi untuk menghapus keyword
    const removeKeyword = (id: number) => {
        const newIds = keywordIds.filter(keywordId => keywordId !== id);
        setKeywordIds(newIds);
        onChange?.(newIds.join(","));
    };

    return (
        <div className="flex flex-col gap-2">
            {label && <Label>{label}</Label>}

            {/* Menampilkan chip untuk setiap keyword yang sudah terpilih */}
            <div className="flex flex-wrap gap-2">
                {keywordIds.map((id) => (
                    <Badge key={id} variant="secondary" className="pr-2 flex items-center gap-1">
                        {keywordNames[id] || `ID: ${id}`}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeKeyword(id)}
                            className="p-0"
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    </Badge>
                ))}
            </div>

            {/* Combobox (Command) untuk mencari saran keyword */}
            <Command className="border rounded">
                <CommandInput
                    placeholder="Search keywords..."
                    value={searchQuery}
                    onValueChange={setSearchQuery}
                />
                <CommandList>
                    {isLoading && <CommandEmpty>Loading...</CommandEmpty>}
                    {!isLoading && suggestions.length === 0 && (
                        <CommandEmpty>No keywords found.</CommandEmpty>
                    )}
                    <CommandGroup>
                        {suggestions.map((item) => (
                            <CommandItem
                                key={item.id}
                                onSelect={() => {
                                    addKeyword(item);
                                    setSearchQuery("");
                                }}
                            >
                                {item.name}
                            </CommandItem>
                        ))}
                    </CommandGroup>
                </CommandList>
            </Command>
        </div>
    );
};

export default KeywordsFilter;