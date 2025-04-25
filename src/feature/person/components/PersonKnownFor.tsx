import { FC } from 'react';
import { PersonCombinedCredits, usePersonCombinedCredits } from '../hooks/usePersonCombinedCredits';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Star } from 'lucide-react';
import { formatDate } from 'date-fns';
import Link from 'next/link';
import { cn, getPosterImageUrl, slugify } from '@/lib/utils';
interface Props {
    // Define any props you need here
    // For example, if you want to pass a personId or other data
    className?: string
    data: PersonCombinedCredits["cast"]
    // Add more props as needed
}

const PersonKnownFor: FC<Props> = ({ className, data }) => {
    const knownFor = data
        .filter((item) =>
            item.poster_path &&
            (item.media_type === "movie" || item.media_type === "tv") &&
            item.vote_average > 0 &&
            item.popularity > 0 &&
            item.vote_count > 0 // Ensure these fields have valid values
        )
        .sort((a, b) => {
            // Sort by a combination of vote_average, popularity, and vote_count
            const scoreA = (a.vote_average as number) * 0.5 + (a.popularity as number) * 0.3 + (a.vote_count as number) * 0.2;
            const scoreB = (b.vote_average as number) * 0.5 + (b.popularity as number) * 0.3 + (b.vote_count as number) * 0.2;
            return scoreB - scoreA;
        })
        .slice(0, 4); // Take the top 4

    return (
        <div className={cn("flex flex-col gap-4", className)}>
            <h2 className="text-sm font-semibold md:text-base lg:text-lg xl:text-xl">Known For</h2>
            <div className="grid grid-cols-2 gap-4">
                {knownFor.map((item) => (
                    <Card key={item.id} className="flex flex-row gap-0 p-0 overflow-hidden bg-transparent rounded-md shadow-none md:gap-0 lg:gap-0 xl:gap-0">
                        <Link href={`/${item.media_type}/${item.id}-${slugify(item.title || item.name)}`} className='w-1/3 max-h-36'>
                            <Image
                                width={200}
                                height={300}
                                src={`${getPosterImageUrl(item.poster_path)}}`}
                                alt={item.title || item.name}
                                className="object-cover w-full h-full rounded-l-lg"
                            />
                        </Link>
                        <CardContent className='flex flex-col w-2/3 gap-2 px-4 py-2'>
                            <Link href={`/${item.media_type}/${item.id}-${slugify(item.title || item.name)}`}>
                                <CardTitle className='hover:underline'>{item.title || item.name}</CardTitle>
                            </Link>
                            <div className="flex items-center gap-1">
                                <Star fill='currentColor' className='text-yellow-400' size={14} />
                                <p className="text-sm font-semibold text-muted-foreground">{(item.vote_average as number).toFixed(1)}</p>
                            </div>
                            <CardDescription>{item.character}</CardDescription>
                            <CardDescription>{formatDate(new Date(item.release_date || item.first_air_date), "MMMM dd, yyyy")}</CardDescription>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};

export default PersonKnownFor;