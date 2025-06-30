import MediaDetail from '@/feature/media/components/detail/MediaDetailWrapper';
import { slugToTitle } from '@/lib/utils';
import { Metadata } from 'next';

// ✅ Metadata SEO dengan format title yang diinginkan (contoh: "A Minecraft Movie | Cinemania")
export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    // Jangan hapus await pada params
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const movieTitle = slugToTitle(decodedSlug);

    return {
        title: `${movieTitle} | Cinemania`,
        description: `Discover more about "${movieTitle}". See full details, cast, release date, and more.`,
        keywords: [movieTitle, 'Movie Detail', 'Cast', 'Release Date', 'Movie Info'],
        openGraph: {
            title: `${movieTitle} | Cinemania`,
            description: `Explore everything about "${movieTitle}".`,
            type: 'website',
            url: `https://yourdomain.com/movie/${slug}`,
        },
    };
}

// ✅ Page Component sebagai async function
export default async function MovieDetailPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    // Jangan hapus await pada params
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);

    // Ekstrak ID numerik dari slug, misalnya "950387-a-minecraft-movie"
    const id = Number(decodedSlug.split('-')[0]);

    return (
        <MediaDetail id={id} mediaType="movie" />
    );
}
