import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { getPosterImageUrl, slugify } from '@/lib/utils';
import { formatDate } from 'date-fns';
import { Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { FC } from 'react';
interface Props {
  id: number;
  title: string;
  posterPath: string;
  rating: number;
  releaseDate?: string;
  mediaType: "movie" | "tv";
  description?: string;
  genre_ids?: number[];
  character: string
}

const MediaCastCard: FC<Props> = ({ id, title, posterPath, rating, releaseDate, mediaType, character }) => {
  return (
    <Card key={id} className="flex flex-row gap-2 p-2 overflow-hidden bg-transparent rounded-md shadow-none">
      <Link href={`/${mediaType}/${id}-${slugify(title)}`}>
        <Image
          width={200}
          height={300}
          src={`${getPosterImageUrl(posterPath)}`}
          alt={title}
          className="object-cover w-12 h-full rounded"
        />
      </Link>
      <CardContent className='flex flex-col p-0 grow'>
        <div className="flex items-center justify-between">
          <Link href={`/${mediaType}/${id}-${slugify(title)}`}>
            <CardTitle className='text-xs hover:underline md:text-sm lg:text-base'>{title}</CardTitle>
          </Link>
          <CardDescription>{releaseDate ? formatDate(new Date(releaseDate), "MMMM dd, yyyy") : "Unknown Date"}</CardDescription>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Star fill='currentColor' className='text-yellow-400' size={12} />
          <CardDescription className="text-xs">{(rating).toFixed(1)}</CardDescription>
        </div>
        <CardDescription>{character}</CardDescription>
      </CardContent>
    </Card>
  );
};

export default MediaCastCard;