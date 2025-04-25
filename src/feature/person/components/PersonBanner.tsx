import { FC, useState } from 'react';
import { PersonDetails } from '../hooks/usePerson';
import Image from 'next/image';
import { cn } from "@/lib/utils";
import PersonKnownFor from './PersonKnownFor';
import { PersonCombinedCredits } from '../hooks/usePersonCombinedCredits';

interface Props {
    data: PersonDetails;
    personCastData: PersonCombinedCredits["cast"]
}

const PersonBanner: FC<Props> = ({ data, personCastData }) => {
    const [expanded, setExpanded] = useState(false);

    const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 lg:flex-row md:gap-4 lg:gap-6">
                <div className="flex flex-col w-full gap-4 lg:w-3/12">
                    <div className="relative hidden w-full h-96 lg:block">
                        <Image
                            src={`${imagePath}/w500${data.profile_path}`}
                            alt={data.name}
                            fill
                            className="object-cover rounded-lg"
                        />
                    </div>
                    <div className="flex flex-col gap-4">
                        <h2 className='text-sm font-semibold md:text-base lg:text-lg xl:text-xl'>Personal Info</h2>
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-2">
                                <p className="text-xs font-semibold md:text-sm lg:text-base">Known For</p>
                                <p className="text-sm text-muted-foreground">{data.known_for_department}</p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <p className="text-xs font-semibold md:text-sm lg:text-base">Birthday</p>
                                <p className="text-sm text-muted-foreground">{data.birthday}</p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <p className="text-xs font-semibold md:text-sm lg:text-base">Place of Birth</p>
                                <p className="text-sm text-muted-foreground">{data.place_of_birth}</p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <p className="text-xs font-semibold md:text-sm lg:text-base">Also Known As</p>
                                <p className="flex flex-wrap text-sm text-muted-foreground">{data.also_known_as.join(", ")}</p>
                            </div>
                        </div>
                        <PersonKnownFor data={personCastData} className='flex lg:hidden' />
                    </div>
                </div>
                <div className="flex flex-col order-first w-full gap-4 lg:w-9/12 lg:order-last">
                    <h1 className="text-xl font-bold md:text-2xl lg:text-3xl xl:text-4xl">{data.name}</h1>
                    <div className="relative w-full h-96 lg:hidden">
                        <Image
                            src={`${imagePath}/w500${data.profile_path}`}
                            alt={data.name}
                            fill
                            className="object-cover rounded-lg"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <h2 className='text-sm font-semibold md:text-base lg:text-lg xl:text-xl'>Biography</h2>
                        {data.biography && (
                            <div>
                                <p className={cn("whitespace-pre-wrap", !expanded && "line-clamp-5")}>
                                    {data.biography}
                                </p>
                                {data.biography.split(" ").length > 50 && (
                                    <button
                                        className="mt-2 font-medium text-primary"
                                        onClick={() => setExpanded((prev) => !prev)}
                                    >
                                        {expanded ? "Show Less" : "Read More"}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    <PersonKnownFor data={personCastData} className='hidden lg:flex' />
                </div>
            </div>
        </div>
    );
};

export default PersonBanner;