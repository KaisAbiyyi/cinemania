import { Moon, Sun } from "lucide-react";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { SidebarTrigger } from "../ui/sidebar";
import { useTheme } from "next-themes";

const Navbar = () => {
    const { setTheme } = useTheme();

    return (
        <nav className="sticky top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 p-4 border-b bg-background" role="navigation" aria-label="Main Navigation">

            {/* Sidebar Button */}
            <SidebarTrigger aria-label="Open sidebar" />

            <div className="flex gap-4">
                {/* ✅ Search Input dengan Label */}
                <div className="relative">
                    <label htmlFor="search" className="sr-only">Search Movies and TV Shows</label>
                    <Input id="search" className="w-full md:w-80" placeholder="Search Movies or TV Shows..." />
                </div>

                {/* ✅ Theme Toggle */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" aria-label="Toggle theme">
                            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                            <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setTheme("light")}>
                            Light
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme("dark")}>
                            Dark
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme("system")}>
                            System
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </nav>
    );
}

export default Navbar;
