import type { Filters } from "@/types/filters";

export type DiscoveryDatePreset =
  | "movie-now-playing"
  | "movie-upcoming"
  | "tv-airing-today"
  | "tv-on-tv";

function formatUtcCalendarDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addMonths(date: Date, deltaMonths: number): Date {
  const copy = new Date(date.getTime());
  copy.setMonth(copy.getMonth() + deltaMonths);
  return copy;
}

function addDays(date: Date, deltaDays: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + deltaDays);
  return copy;
}

/**
 * Resolves rolling TMDB discovery date windows on the client so statically
 * prerendered App Router pages never freeze stale build-time dates into HTML.
 */
export function resolveDiscoveryDatePresetFilters(
  preset: DiscoveryDatePreset,
  referenceDate: Date = new Date()
): Partial<Filters> {
  const today = formatUtcCalendarDate(referenceDate);

  switch (preset) {
    case "movie-now-playing":
      return {
        release_date_gte: formatUtcCalendarDate(addMonths(referenceDate, -1)),
        release_date_lte: today,
        with_release_type: "2|3",
      };
    case "movie-upcoming":
      return {
        release_date_gte: today,
        release_date_lte: formatUtcCalendarDate(addMonths(referenceDate, 1)),
        with_release_type: "2|3",
      };
    case "tv-airing-today":
      return {
        air_date_gte: today,
        air_date_lte: today,
      };
    case "tv-on-tv":
      return {
        air_date_gte: today,
        air_date_lte: formatUtcCalendarDate(addDays(referenceDate, 7)),
      };
  }
}

export function resolveDiscoveryDatePresetQueryParams(
  preset: DiscoveryDatePreset,
  referenceDate: Date = new Date()
): Record<string, string> {
  const filters = resolveDiscoveryDatePresetFilters(preset, referenceDate);
  const params: Record<string, string> = {};

  if (filters.release_date_gte) params["release_date.gte"] = filters.release_date_gte;
  if (filters.release_date_lte) params["release_date.lte"] = filters.release_date_lte;
  if (filters.air_date_gte) params["air_date.gte"] = filters.air_date_gte;
  if (filters.air_date_lte) params["air_date.lte"] = filters.air_date_lte;
  if (filters.with_release_type) params.with_release_type = filters.with_release_type;

  return params;
}
