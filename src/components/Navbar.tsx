import { FC, FormEvent, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

const Navbar: FC = () => {
    const [searchParams, setSearchParams] = useSearchParams()
    const navigate = useNavigate()
    const [searchQuery, setSearchQuery] = useState<string>(searchParams.get("q") || "")

    const handleSearch = (e: FormEvent) => {
        e.preventDefault()
        setSearchParams({ q: searchQuery })
        navigate(`/search?q=${encodeURIComponent(searchQuery)}`)

    }

    return (
        <div className="sticky top-0 z-50 flex justify-end gap-4 p-4 bg-background">
            <form onSubmit={handleSearch} className="relative flex items-center gap-2">
                <Input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} className="lg:w-96" placeholder="Search..." />
                <Button type="button" onClick={handleSearch} variant="ghost" className="text-primary hover:text-primary"><Search /></Button>
            </form>
            <Button>SIGN IN</Button>
        </div>
    );
}

export default Navbar;