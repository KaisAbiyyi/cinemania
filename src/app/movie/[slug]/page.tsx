import MediaDetail from '@/feature/media/components/detail/MediaDetailWrapper';
import { buildPageMetadata } from '@/lib/metadata';
import { slugToTitle } from '@/lib/utils';
import { Metadata } from 'next';

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const movieTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: movieTitle,
        description: `Discover more about "${movieTitle}". See full details, cast, release date, and more.`,
        path: `/movie/${slug}`,
        keywords: [movieTitle, 'Movie Detail', 'Cast', 'Release Date', 'Movie Info'],
    });
}

export default async function MovieDetailPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const id = Number(decodedSlug.split('-')[0]);

    return (
        <MediaDetail id={id} mediaType="movie" />
    );
}
