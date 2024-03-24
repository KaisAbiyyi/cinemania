import { CardContent, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { FC, HTMLAttributes } from "react";
import { useParams } from "react-router-dom";
import PersonActing from "./PersonActing";
import PersonActingSkeleton from "./Skeletons/PersonActingSkeleton";

interface PersonBioProps extends HTMLAttributes<HTMLDivElement> {
    data: any
    className?: string
}

const PersonBio: FC<PersonBioProps> = ({ data, className }) => {
    const { id } = useParams()
    const splittedId = ((id as string).split("-"))[0]
    const token = import.meta.env.VITE_TMDB_API_RAT

    console.log(data)
    const biography: string[] = data.biography.split("\n").filter((line: string) => line.length > 0);

    const { data: PersonCredits, isPending: PersonCreditsPending } = useQuery({
        queryKey: [`getPersonCredits${splittedId}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/person/${splittedId}/combined_credits?language=en-US`, { headers: { Authorization: `Bearer ${token}` } })
            return data
        }
    })

    return (
        <div className={cn("flex flex-col gap-8", className)}>
            <h1 className="flex gap-2 text-2xl font-bold lg:text-4xl text-background-foreground">
                {data.name}
            </h1>
            <div className="flex flex-col gap-4">
                <CardTitle className="text-lg">Biography</CardTitle>
                <CardContent className="flex flex-col gap-2 p-0">
                    {biography.map((item: string, index: number) => (
                        <p key={index}>{item}</p>
                    ))}
                </CardContent>
                {
                    PersonCreditsPending ?
                        <PersonActingSkeleton/> :
                        <PersonActing data={PersonCredits} className="flex flex-col gap-8 p-0" />
                }
            </div>
        </div>
    );
}

export default PersonBio;