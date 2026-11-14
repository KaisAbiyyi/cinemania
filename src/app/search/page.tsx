import SearchWrapper from '@/feature/search/components/SearchWrapper';
import { buildPageMetadata } from '@/lib/metadata';
import type { Metadata } from 'next';
import React from 'react';

// Intentional dynamic rendering: reads per-request ?q= query string for metadata and SSR heading
export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }): Promise<Metadata> {
    const resolvedSearchParams = await searchParams;
    const rawQuery = resolvedSearchParams.q?.trim() || '';
    const displayQuery = rawQuery || 'Search';
    const path = rawQuery ? `/search?q=${encodeURIComponent(rawQuery)}` : '/search';

    return buildPageMetadata({
        title: displayQuery,
        description: rawQuery
            ? `Search results for "${rawQuery}" on Cinemania.`
            : 'Search movies, TV shows, people, and keywords on Cinemania.',
        path,
        noIndex: true,
    });
}

const SearchPage = async ({ searchParams }: { searchParams: Promise<{ q?: string }> }) => {
    const resolvedSearchParams = await searchParams;
    const query = resolvedSearchParams.q || '';

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
