/**
 * Shared client pagination helpers for deduplicating infinite-scroll items across pages.
 */

export interface PaginatedResults<T> {
  results?: readonly T[] | null;
}

export function dedupeByKey<T>(
  items: readonly T[],
  getKey: (item: T) => string | number
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    if (item == null) continue;
    const rawKey = getKey(item);
    const key = String(rawKey);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

export function dedupeInfinitePages<TItem>(
  pages: readonly PaginatedResults<TItem>[] | undefined,
  getKey: (item: TItem) => string | number
): TItem[] {
  if (!pages || pages.length === 0) {
    return [];
  }

  const flattened: TItem[] = [];
  for (const page of pages) {
    if (!page || !Array.isArray(page.results)) continue;
    flattened.push(...page.results);
  }

  return dedupeByKey(flattened, getKey);
}
