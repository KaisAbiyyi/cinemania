import type { Filters } from "@/types/filters";

export type DiscoveryDatePreset =
  | "movie-now-playing"
  | "movie-upcoming"
  | "tv-airing-today"
  | "tv-on-tv";

export interface CalendarDateOptions {
  /**
   * Optional IANA time zone (e.g. "Asia/Jakarta" or "UTC").
   * By default, presets use the viewer's local calendar day rather than UTC so
   * boundaries like 00:30 +07 resolve to the viewer's current local calendar date.
   */
  timeZone?: string;
}

export interface CalendarYmd {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

export function formatCalendarYmd(ymd: CalendarYmd): string {
  return `${pad4(ymd.year)}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}

export function parseCalendarDateKey(dayKey: string): CalendarYmd | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInCalendarMonth(year, month)) {
    return undefined;
  }
  return { year, month, day };
}

export function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Extracts YYYY-MM-DD components under viewer-local calendar semantics by
 * default, or under an explicit IANA timeZone when supplied.
 */
export function getCalendarYmd(
  date: Date = new Date(),
  options?: CalendarDateOptions
): CalendarYmd {
  if (options?.timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: options.timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    return { year, month, day };
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export function getLocalCalendarDateKey(
  date: Date = new Date(),
  options?: CalendarDateOptions
): string {
  return formatCalendarYmd(getCalendarYmd(date, options));
}

/**
 * Shifts a calendar date by whole months while clamping end-of-month dates to
 * the target month's last valid day (e.g. 2026-03-31 - 1 month -> 2026-02-28).
 */
export function addCalendarMonthsClamped(
  ymd: CalendarYmd,
  deltaMonths: number
): CalendarYmd {
  const totalMonths = ymd.year * 12 + (ymd.month - 1) + deltaMonths;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (((totalMonths % 12) + 12) % 12) + 1;
  const maxDay = daysInCalendarMonth(targetYear, targetMonth);

  return {
    year: targetYear,
    month: targetMonth,
    day: Math.min(ymd.day, maxDay),
  };
}

/**
 * Shifts a calendar date by whole calendar days via Gregorian day arithmetic
 * (immune to local DST 23h/25h transitions).
 */
export function addCalendarDays(ymd: CalendarYmd, deltaDays: number): CalendarYmd {
  const shifted = new Date(
    Date.UTC(ymd.year, ymd.month - 1, ymd.day + deltaDays)
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Returns milliseconds remaining until shortly after the next viewer-local
 * midnight (00:00:00.050) for long-lived tab day-boundary refreshes.
 */
export function getMsUntilNextLocalMidnight(now: Date = new Date()): number {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    50
  );
  return Math.max(50, nextMidnight.getTime() - now.getTime());
}

export function resolveDiscoveryDatePresetFiltersForYmd(
  preset: DiscoveryDatePreset,
  anchor: CalendarYmd
): Partial<Filters> {
  const today = formatCalendarYmd(anchor);

  switch (preset) {
    case "movie-now-playing":
      return {
        release_date_gte: formatCalendarYmd(addCalendarMonthsClamped(anchor, -1)),
        release_date_lte: today,
        with_release_type: "2|3",
      };
    case "movie-upcoming":
      return {
        release_date_gte: today,
        release_date_lte: formatCalendarYmd(addCalendarMonthsClamped(anchor, 1)),
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
        air_date_lte: formatCalendarYmd(addCalendarDays(anchor, 7)),
      };
  }
}

export function filtersToDiscoveryQueryParams(
  filters: Partial<Filters>
): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters.release_date_gte) params["release_date.gte"] = filters.release_date_gte;
  if (filters.release_date_lte) params["release_date.lte"] = filters.release_date_lte;
  if (filters.air_date_gte) params["air_date.gte"] = filters.air_date_gte;
  if (filters.air_date_lte) params["air_date.lte"] = filters.air_date_lte;
  if (filters.with_release_type) params.with_release_type = filters.with_release_type;

  return params;
}

/**
 * Resolves rolling TMDB discovery date windows on the client using viewer-local
 * calendar day semantics and clamped calendar-month arithmetic so statically
 * prerendered App Router pages never freeze stale build-time dates into HTML.
 */
export function resolveDiscoveryDatePresetFilters(
  preset: DiscoveryDatePreset,
  referenceDate: Date = new Date(),
  options?: CalendarDateOptions
): Partial<Filters> {
  return resolveDiscoveryDatePresetFiltersForYmd(
    preset,
    getCalendarYmd(referenceDate, options)
  );
}

export function resolveDiscoveryDatePresetQueryParams(
  preset: DiscoveryDatePreset,
  referenceDate: Date = new Date(),
  options?: CalendarDateOptions
): Record<string, string> {
  return filtersToDiscoveryQueryParams(
    resolveDiscoveryDatePresetFilters(preset, referenceDate, options)
  );
}
