"use client";

import { useEffect, useRef } from "react";

interface UseInfiniteScrollObserverOptions {
  enabled?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError?: boolean;
  pageCount: number;
  fetchNextPage: () => Promise<unknown> | unknown;
  threshold?: number;
  rootMargin?: string;
}

/**
 * Shared IntersectionObserver hook for discovery/genre/keyword/trending grids.
 * Deduplicates concurrent next-page triggers per loaded page count and halts auto-fetch on error
 * so users can trigger an accessible manual retry without retry storms.
 */
export function useInfiniteScrollObserver({
  enabled = true,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError = false,
  pageCount,
  fetchNextPage,
  threshold = 0.1,
  rootMargin = "100px",
}: UseInfiniteScrollObserverOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inFlightPageCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isFetchingNextPage) {
      inFlightPageCountRef.current = null;
    }
  }, [isFetchingNextPage, pageCount]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !enabled || !hasNextPage || isFetchingNextPage || isFetchNextPageError) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!enabled || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
        if (inFlightPageCountRef.current === pageCount) return;

        inFlightPageCountRef.current = pageCount;
        void fetchNextPage();
      },
      { threshold, rootMargin }
    );

    observer.observe(target);

    return () => {
      observer.unobserve(target);
      observer.disconnect();
    };
  }, [
    enabled,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    pageCount,
    fetchNextPage,
    threshold,
    rootMargin,
  ]);

  return sentinelRef;
}
