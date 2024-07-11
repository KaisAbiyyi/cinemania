import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { CardDescription } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { FC, useState } from "react";

interface FilterProps {
    sortBy: string;
    setSortBy: (sortBy: string) => void;
    FromReleaseDate: Date | undefined;
    setFromReleaseDate: (date: Date) => void;
    ToReleaseDate: Date | undefined;
    setToReleaseDate: (date: Date) => void;
    selectedGenres: Array<string>;
    setSelectedGenres: (genres: Array<string>) => void;
    Genre: any;
    GenrePending: boolean;
    userScore: Array<number>;
    setUserScore: (score: Array<number>) => void;
    minimumUserVotes: Array<number>;
    setMinimumUserVotes: (votes: Array<number>) => void;
    runtime: Array<number>;
    setRuntime: (runtime: Array<number>) => void;
    isMovie?: boolean
}

const Filter: FC<FilterProps> = ({
    sortBy,
    setSortBy,
    FromReleaseDate,
    setFromReleaseDate,
    ToReleaseDate,
    setToReleaseDate,
    selectedGenres,
    setSelectedGenres,
    Genre,
    GenrePending,
    userScore,
    setUserScore,
    minimumUserVotes,
    setMinimumUserVotes,
    runtime,
    setRuntime,
    isMovie
}) => {
    const [sort_by, set_sort_by] = useState<string>(sortBy)
    const [from_release_date, set_from_release_date] = useState<Date>(FromReleaseDate as Date)
    const [to_release_date, set_to_release_date] = useState<Date>(ToReleaseDate as Date)
    const [selected_genres, set_selected_genres] = useState<string[]>(selectedGenres)
    const [user_score, set_user_score] = useState<number[]>(userScore)
    const [minimum_user_votes, set_minimum_user_votes] = useState<number[]>(minimumUserVotes)
    const [run_time, set_run_time] = useState<number[]>(runtime)

    const sortByHandler = (e: string) => {
        set_sort_by(e);
    };
    const selectGenreHandler = (genreName: string) => {
        // @ts-ignore
        set_selected_genres((prevGenres: string[]) => {
            if (prevGenres.includes(genreName)) {
                return prevGenres.filter((genre: string) => genre !== genreName);
            } else {
                return [...prevGenres, genreName];
            }
        });
    };

    const setFromDate = (date: Date | undefined) => {
        if (date instanceof Date) {
            set_from_release_date(date);
        }
    };

    const setToDate = (date: Date | undefined) => {
        if (date instanceof Date) {
            set_to_release_date(date);
        }
    };

    const filterHandler = () => {
        setSortBy(sort_by)
        setFromReleaseDate(from_release_date)
        setToReleaseDate(to_release_date)
        setSelectedGenres(selected_genres)
        setUserScore(user_score)
        setMinimumUserVotes(minimum_user_votes)
        setRuntime(run_time)
    }

    return (
        <Accordion type="single" collapsible>
            <AccordionItem value="item-1">
                <AccordionTrigger className={buttonVariants({ variant: "outline", className: "hover:no-underline !justify-between flex-none w-[100px]" })} >Filter</AccordionTrigger>
                <AccordionContent>
                    <div className="flex flex-col gap-8">
                        <div className="flex gap-4 mt-4">
                            <div className="flex flex-col w-1/2 gap-4">
                                <Select onValueChange={sortByHandler}>
                                    <SelectTrigger title="Filter">
                                        <SelectValue placeholder="Sort by" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="popularity.desc">Popularity DESC</SelectItem>
                                        <SelectItem value="popularity.asc">Popularity ASC</SelectItem>
                                        <SelectItem value="vote_average.desc">Rating DESC</SelectItem>
                                        <SelectItem value="vote_average.asc">Rating ASC</SelectItem>
                                        {isMovie ?
                                            <>
                                                <SelectItem value="primary_release_date.desc">Release Date DESC</SelectItem>
                                                <SelectItem value="primary_release_date.asc">Release Date ASC</SelectItem>
                                            </>
                                            :
                                            <>
                                                <SelectItem value="first_air_date.desc">First Air Date DESC</SelectItem>
                                                <SelectItem value="first_air_date.asc">First Air Date ASC</SelectItem>
                                            </>
                                        }
                                        <SelectItem value="title.asc">Title (A-Z)</SelectItem>
                                        <SelectItem value="title.desc">Title (Z-A)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="flex flex-col gap-2">
                                    <CardDescription className="ml-1">Release Date</CardDescription>
                                    <div className="flex gap-2">
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "justify-start w-full text-left font-normal",
                                                        !from_release_date && "text-muted-foreground"
                                                    )}
                                                >
                                                    <CalendarIcon className="w-4 h-4 mr-2" />
                                                    {from_release_date ? format(from_release_date, "PPP") : <span>Pick a Date</span>}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0">
                                                <Calendar
                                                    mode="single"
                                                    selected={from_release_date}
                                                    onSelect={setFromDate}
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "justify-start text-left font-normal w-full",
                                                        !to_release_date && "text-muted-foreground"
                                                    )}
                                                >
                                                    <CalendarIcon className="w-4 h-4 mr-2" />
                                                    {to_release_date ? format(to_release_date, "PPP") : <span>Pick a Date</span>}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0">
                                                <Calendar
                                                    mode="single"
                                                    selected={to_release_date}
                                                    onSelect={setToDate}
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <CardDescription>Genres</CardDescription>
                                    <div className="flex flex-wrap gap-2">
                                        {!GenrePending && Genre.genres.map((genre: any) => (
                                            <Button variant={selected_genres.includes(genre.id) ? "default" : "secondary"} key={genre.id} onClick={() => selectGenreHandler(genre.id)}>{genre.name}</Button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-col w-1/2 gap-6">
                                <div className="flex flex-col gap-4">
                                    <CardDescription>User Score</CardDescription>
                                    <div className="flex justify-between">
                                        <CardDescription className="text-xs">0</CardDescription>
                                        <CardDescription className="text-xs">5</CardDescription>
                                        <CardDescription className="text-xs">10</CardDescription>
                                    </div>
                                    <Slider defaultValue={user_score} step={1} max={10} minStepsBetweenThumbs={1} onValueChange={(e) => set_user_score(e)} />
                                </div>
                                <div className="flex flex-col gap-4">
                                    <CardDescription>Minimum User Votes</CardDescription>
                                    <div className="flex justify-between">
                                        <CardDescription className="text-xs">0</CardDescription>
                                        <CardDescription className="text-xs">100</CardDescription>
                                        <CardDescription className="text-xs">200</CardDescription>
                                        <CardDescription className="text-xs">300</CardDescription>
                                        <CardDescription className="text-xs">400</CardDescription>
                                        <CardDescription className="text-xs">500</CardDescription>
                                    </div>
                                    <Slider defaultValue={minimum_user_votes} step={50} max={500} onValueChange={(e) => set_minimum_user_votes(e)} />
                                </div>
                                <div className="flex flex-col gap-4">
                                    <CardDescription>Runtime</CardDescription>
                                    <div className="flex justify-between">
                                        <CardDescription className="text-xs">0</CardDescription>
                                        <CardDescription className="text-xs">120</CardDescription>
                                        <CardDescription className="text-xs">140</CardDescription>
                                        <CardDescription className="text-xs">360</CardDescription>
                                    </div>
                                    <Slider defaultValue={run_time} step={15} max={360} minStepsBetweenThumbs={1} onValueChange={(e) => set_run_time(e)} />
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button type="button" onClick={filterHandler}>Apply Filter</Button>
                        </div>
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    );
};

export default Filter;
