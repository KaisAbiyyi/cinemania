"use client";

import { useRouter } from "next/navigation";
import SearchBar from "./SearchBar";
import ThemeToggle from "./ThemeToggle";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Suspense } from "react";

const Navbar = () => {
    const router = useRouter();

    const handleSearch = (query: string) => {
        router.push(`/search?q=${encodeURIComponent(query)}`);
    };

    return (
        <nav className="sticky top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 py-4 px-8 border-b bg-background" role="navigation" aria-label="Main Navigation">
            <SidebarTrigger aria-label="Open sidebar" />
            <div className="flex gap-4 items-center">
                <Suspense fallback={null}>
                    <SearchBar onSearch={handleSearch} />
                </Suspense>
                <ThemeToggle />
            </div>
        </nav>
    );
};

export default Navbar;
