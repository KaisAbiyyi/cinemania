import { FC } from "react";
import { Input } from "../ui/input";
import { CardTitle } from "../ui/card";
import { Search } from "lucide-react";
import { Button } from "../ui/button";

const HeroSegment: FC = () => {
    return (
        <div className="flex flex-col gap-8 p-4 md:p-16 text-primary-foreground bg-gradient-to-b from-primary via-primary to-transparent">
            <div className="flex flex-col gap-4">
                <CardTitle className="text-5xl text-bold">Welcome</CardTitle>
                <CardTitle className="text-xl md:text-2xl">We have millions of movies, tv shows an people to discover. Explore the cinema world now.</CardTitle>
            </div>
            <div className="flex">
                <Input type="search" className="rounded-r-none" placeholder="Search for a movie, tv show, person" />
                <Button className="rounded-l-none bg-background text-primary"><Search /></Button>
            </div>
        </div>
    );
}

export default HeroSegment;