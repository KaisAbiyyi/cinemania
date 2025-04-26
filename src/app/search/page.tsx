import SearchWrapper from '@/feature/search/components/SearchWrapper';
import React from 'react';

export async function generateMetadata({ searchParams }: { searchParams: { q?: string } }) {
    const query = searchParams.q || 'Search';
    return {
        title: `${query} | Cinemania`,
        description: `Search results for "${query}" on Cinemania.`,
        openGraph: {
            title: `${query} | Cinemania`,
            description: `Search results for "${query}" on Cinemania.`,
            url: `https://cinemania.com/search?q=${encodeURIComponent(query)}`,
            siteName: 'Cinemania',
            type: 'website',
            images: [
                {
                    url: 'https://cinemania.com/og-image.jpg',
                    width: 1200,
                    height: 630,
                    alt: 'Cinemania Search Results',
                },
            ],
        },
    };
}

const SearchPage = ({ searchParams }: { searchParams: { q?: string } }) => {
    const query = searchParams.q || '';

    return (
        <>
            <h1 className='text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl'>
                Search Results for: {query}
            </h1>
            <SearchWrapper query={query} />
        </>

    );
};

export default SearchPage;
