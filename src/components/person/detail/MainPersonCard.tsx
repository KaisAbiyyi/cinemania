import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { differenceInYears, format } from "date-fns";
import { FC, HTMLAttributes } from "react";

interface MainPersonCardProps extends HTMLAttributes<HTMLDivElement> {
    data: any,
    className?: string
}

const MainPersonCard: FC<MainPersonCardProps> = ({ data, className, ...props }) => {
    console.log(data)
    const imagePath = import.meta.env.VITE_TMDB_POSTER_URL
    return (
        <Card className={cn("bg-secondary/50 relative rounded-sm h-fit lg:rounded-lg flex flex-row lg:flex-col", className)}{...props}>
            <img src={`${imagePath}/original/${data.profile_path}`} alt={data.name} className="absolute inset-0 z-0 object-cover w-full h-full opacity-25 lg:relative lg:opacity-100 lg:h-96" />
            <div className="z-10 flex w-full gap-4 bg-gradient-to-b from-transparent via-secondary/70 to-secondary lg:flex-col">
                <CardHeader className="flex flex-col w-1/2 gap-4 p-4 lg:w-full">
                    <div className="flex flex-col gap-2">
                        <CardTitle className="text-base">Known For</CardTitle>
                        <CardDescription>{data.known_for_department}</CardDescription>
                    </div>
                    <div className="flex flex-col gap-2">
                        <CardTitle className="text-base">Gender</CardTitle>
                        <CardDescription>{data.gender === 2 ? "Male" : "Female"}</CardDescription>
                    </div>
                    <div className="flex flex-col gap-2">
                        <CardTitle className="text-base">Birthday</CardTitle>
                        <CardDescription>{format(data.birthday, "MMMM d, yyyy")} ({differenceInYears(new Date(), new Date(data.birthday))} years old)</CardDescription>
                    </div>
                    <div className="flex flex-col gap-2">
                        <CardTitle className="text-base">Place of Birth</CardTitle>
                        <CardDescription>{data.place_of_birth}</CardDescription>
                    </div>
                </CardHeader>
                <CardHeader className="flex flex-col w-1/2 gap-4 p-4 lg:w-full">
                    <div className="flex flex-col gap-2">
                        <CardTitle className="text-base">Also Known As</CardTitle>
                        <div className="flex flex-col gap-2">
                            {data.also_known_as.map((item: string) => (
                                <CardDescription>{item}</CardDescription>
                            ))}
                        </div>
                    </div>
                </CardHeader>
            </div>
        </Card>
    );
}

export default MainPersonCard;