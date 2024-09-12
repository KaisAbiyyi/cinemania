import { FC, FormEvent, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { LogIn, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

const Navbar: FC = () => {
    const [searchParams, setSearchParams] = useSearchParams()
    const navigate = useNavigate()
    const [searchQuery, setSearchQuery] = useState<string>(searchParams.get("q") || "")

    const handleSearch = (e: FormEvent) => {
        e.preventDefault()
        if (searchQuery.length > 0) {
            setSearchParams({ q: searchQuery })
            navigate(`/search?q=${encodeURIComponent(searchQuery)}`)
        }
    }

    return (
        <div className="sticky top-0 z-50 flex justify-end gap-4 p-4 bg-background">
            <form onSubmit={handleSearch} className="relative flex items-center gap-2">
                <Input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} className="lg:w-96" placeholder="Search..." />
                {searchQuery.length > 0 &&
                    <Button type="button" onClick={handleSearch} variant="ghost" className="text-primary hover:text-primary"><Search /></Button>
                }
            </form>
            <Button title="Login" size={"sm"}><LogIn size={18}/></Button>
        </div>
    );
}

export default Navbar;