import MediaDetail from '@/feature/media/components/detail/MediaDetailWrapper';
import { slugToTitle } from '@/lib/utils';
import { Metadata } from 'next';

// ✅ Metadata SEO dengan format title yang diinginkan (contoh: "A Minecraft TV | Cinemania")
export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    // Jangan hapus await pada params
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);
    const tvTitle = slugToTitle(decodedSlug);

    return {
        title: `${tvTitle} | Cinemania`,
        description: `Discover more about "${tvTitle}". See full details, cast, release date, and more.`,
        keywords: [tvTitle, 'TV Detail', 'Cast', 'Release Date', 'TV Info'],
        openGraph: {
            title: `${tvTitle} | Cinemania`,
            description: `Explore everything about "${tvTitle}".`,
            type: 'website',
            url: `https://yourdomain.com/tv/${slug}`,
        },
    };
}

// ✅ Page Component sebagai async function
export default async function TVDetailPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    // Jangan hapus await pada params
    const { slug } = await params;
    const decodedSlug = decodeURIComponent(slug);

    // Ekstrak ID numerik dari slug, misalnya "950387-a-minecraft-tv"
    const id = Number(decodedSlug.split('-')[0]);

    return (
        <MediaDetail id={id} mediaType="tv" />
    );
}
