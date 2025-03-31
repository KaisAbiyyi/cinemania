"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export default function HeroSearchBar() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [query, setQuery] = useState(searchParams.get("q") || "");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) {
            router.push(`/search?q=${encodeURIComponent(query)}`);
        }
    };

    return (
        <form
            role="search"
            onSubmit={handleSubmit}
            className="flex gap-2 p-4 bg-indigo-950"
            aria-label="Search movies, TV shows, or people"
        >
            <Input
                type="search"
                name="q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for a movie, TV show, or person..."
                className="dark:bg-slate-950 bg-background text-indigo-950 dark:text-indigo-100 dark:placeholder:text-indigo-300"
                aria-label="Search input"
            />
            <Button type="submit" size="icon" aria-label="Search">
                <Search />
            </Button>
        </form>
    );
}
