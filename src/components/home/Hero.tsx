import { Search } from "lucide-react";
import { FC, FormEvent } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { CardTitle } from "../ui/card";
import { Input } from "../ui/input";

function serializeFormQuery(form: HTMLFormElement): Record<string, string> {
    const formData = new FormData(form);
    const params: Record<string, string> = {};

    formData.forEach((value, key) => {
        params[key] = value.toString();
    });

    return params;
}

const HeroSegment: FC = () => {
    // @ts-ignore
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const params = serializeFormQuery(event.currentTarget);
        setSearchParams(params);
        navigate(`/search?${new URLSearchParams(params).toString()}`);
    };

    return (
        <div className="flex flex-col gap-8 p-4 md:p-16 text-primary-foreground bg-primary">
            <div className="flex flex-col gap-4">
                <CardTitle className="text-5xl text-bold">Welcome</CardTitle>
                <CardTitle className="text-xl md:text-2xl">We have millions of movies, TV shows, and people to discover. Explore the cinema world now.</CardTitle>
            </div>
            <form onSubmit={handleSubmit} className="flex">
                <Input
                    name="query"
                    type="search"
                    className="rounded-r-none"
                    placeholder="Search for a movie, TV show, person"
                />
                <Button type="submit" className="rounded-l-none bg-background text-primary">
                    <Search />
                </Button>
            </form>
        </div>
    );
}

export default HeroSegment;
