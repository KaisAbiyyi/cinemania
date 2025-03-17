"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const SearchBar = ({ onSearch }: { onSearch: (query: string) => void }) => {
    const searchParams = useSearchParams();
    const [query, setQuery] = useState("");

    useEffect(() => {
        setQuery(searchParams.get("q") || "");
    }, [searchParams]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) {
            onSearch(query);
        }
    };

    return (
        <form 
            role="search" 
            onSubmit={handleSubmit} 
            className="relative flex items-center gap-2"
            aria-label="Search movies and TV shows"
        >
            <Input
                type="search"
                name="q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Movies or TV Shows..."
                className="w-full md:w-80"
                aria-label="Search input"
            />
            <Button type="submit" size="icon" variant="outline" aria-label="Search">
                <Search />
            </Button>
        </form>
    );
};

export default SearchBar;
