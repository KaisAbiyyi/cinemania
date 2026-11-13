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
    const tvTitle = slugToTitle(decodedSlug);

    return buildPageMetadata({
        title: tvTitle,
        description: `Discover more about "${tvTitle}". See full details, cast, release date, and more.`,
        path: `/tv/${slug}`,
        keywords: [tvTitle, 'TV Detail', 'Cast', 'Release Date', 'TV Info'],
    });
}

export default async function TVDetailPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const id = Number(decodedSlug.split('-')[0]);

    return (
        <MediaDetail id={id} mediaType="tv" />
    );
}
