import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { format } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MediaContainer from "@/feature/media/components/MediaContainer";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import {
  FilterProvider,
  useFilterContext,
} from "@/feature/media/components/filter/FilterProvider";
import apiClient from "@/services/apiClient";
import { getLocalCalendarDateKey } from "@/lib/datePresets";
import { Filters } from "@/types/filters";

const routerPushMock = vi.fn();
let mockedPathname = "/tv/airing-today";
let mockedSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerPushMock,
    prefetch: vi.fn(),
  }),
  usePathname: () => mockedPathname,
  useSearchParams: () => mockedSearchParams,
}));

function installDomPolyfills() {
  if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver = class IntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    } as unknown as typeof IntersectionObserver;
  }

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

function mockApiClient() {
  return vi.spyOn(apiClient, "get").mockImplementation(async (url) => {
    if (url === "/genres") {
      return {
        data: [
          { id: 18, name: "Drama" },
          { id: 28, name: "Action" },
        ],
      } as never;
    }
    if (url === "/languages") {
      return {
        data: [{ iso_639_1: "en", english_name: "English", name: "English" }],
      } as never;
    }
    if (url === "/geolocation") {
      return { data: { country: "US" } } as never;
    }
    if (url === "/providers/region") {
      return { data: { results: [] } } as never;
    }
    return {
      data: { page: 1, results: [], total_pages: 1, total_results: 0 },
    } as never;
  });
}

function FilterProbe() {
  const { filters } = useFilterContext();
  return (
    <pre data-testid="filter-state">
      {JSON.stringify({
        sort_by: filters.sort_by,
        with_genres: filters.with_genres ?? "",
        air_date_gte: filters.air_date_gte,
        air_date_lte: filters.air_date_lte,
        release_date_gte: filters.release_date_gte,
        release_date_lte: filters.release_date_lte,
        with_release_type: filters.with_release_type,
      })}
    </pre>
  );
}

function readProbe(): Record<string, string | undefined> {
  return JSON.parse(screen.getByTestId("filter-state").textContent ?? "{}") as Record<
    string,
    string | undefined
  >;
}

function getLatestMediaCallParams(
  getSpy: ReturnType<typeof mockApiClient>
): Record<string, unknown> | undefined {
  const mediaCalls = getSpy.mock.calls.filter(([url]) => url === "/media");
  const lastCall = mediaCalls[mediaCalls.length - 1];
  return (lastCall?.[1] as { params?: Record<string, unknown> } | undefined)?.params;
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function selectVoteAverageDesc() {
  const sortTrigger = document.getElementById("sort-by-select");
  expect(sortTrigger).toBeTruthy();
  await act(async () => {
    fireEvent.keyDown(sortTrigger!, { key: "ArrowDown" });
    await Promise.resolve();
  });
  const option = screen.getByRole("option", { name: "Vote Average Descending" });
  await act(async () => {
    fireEvent.click(option);
    await Promise.resolve();
  });
}

describe("CINE-009: FilterContainer override isolation across local midnight", () => {
  beforeEach(() => {
    installDomPolyfills();
    routerPushMock.mockReset();
    mockedPathname = "/tv/airing-today";
    mockedSearchParams = new URLSearchParams();
    window.history.replaceState(null, "", "/tv/airing-today");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  it("rolls /tv/airing-today date preset across local midnight after applying sort and genre via UI", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 23, 59, 50, 0));
    const getSpy = mockApiClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const defaults: Filters = { sort_by: "popularity.desc" };
    render(
      <QueryClientProvider client={queryClient}>
        <FilterProvider defaultFilters={defaults} datePreset="tv-airing-today">
          <FilterProbe />
          <FilterContainer mediaType="tv" />
          <MediaContainer mediaType="tv" />
        </FilterProvider>
      </QueryClientProvider>
    );

    await flushMicrotasks();
    expect(readProbe()).toMatchObject({
      sort_by: "popularity.desc",
      air_date_gte: "2026-03-15",
      air_date_lte: "2026-03-15",
    });

    // Open Filter panel, change Sort and Genre, and Apply (without editing dates)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Filter$/i }));
    });
    await flushMicrotasks();

    await selectVoteAverageDesc();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Drama" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    });
    await flushMicrotasks();

    expect(readProbe()).toMatchObject({
      sort_by: "vote_average.desc",
      with_genres: "18",
      air_date_gte: "2026-03-15",
      air_date_lte: "2026-03-15",
    });
    expect(getLatestMediaCallParams(getSpy)).toMatchObject({
      mediaType: "tv",
      sort_by: "vote_average.desc",
      with_genres: "18",
      "air_date.gte": "2026-03-15",
      "air_date.lte": "2026-03-15",
    });

    // Advance clock past local midnight into 2026-03-16 without remount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flushMicrotasks();

    expect(getLocalCalendarDateKey(new Date())).toBe("2026-03-16");
    expect(readProbe()).toMatchObject({
      sort_by: "vote_average.desc",
      with_genres: "18",
      air_date_gte: "2026-03-16",
      air_date_lte: "2026-03-16",
    });
    expect(getLatestMediaCallParams(getSpy)).toMatchObject({
      mediaType: "tv",
      sort_by: "vote_average.desc",
      with_genres: "18",
      "air_date.gte": "2026-03-16",
      "air_date.lte": "2026-03-16",
    });
  });

  it("rolls /movie/now-playing date preset across local midnight after applying genre and sort via UI", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 23, 59, 50, 0));
    mockedPathname = "/movie/now-playing";
    window.history.replaceState(null, "", "/movie/now-playing");

    const getSpy = mockApiClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const defaults: Filters = {
      sort_by: "popularity.desc",
      with_release_type: "2|3",
    };
    render(
      <QueryClientProvider client={queryClient}>
        <FilterProvider defaultFilters={defaults} datePreset="movie-now-playing">
          <FilterProbe />
          <FilterContainer mediaType="movie" />
          <MediaContainer mediaType="movie" />
        </FilterProvider>
      </QueryClientProvider>
    );

    await flushMicrotasks();
    expect(readProbe()).toMatchObject({
      release_date_gte: "2026-02-15",
      release_date_lte: "2026-03-15",
      with_release_type: "2|3",
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Filter$/i }));
    });
    await flushMicrotasks();

    await selectVoteAverageDesc();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Action" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    });
    await flushMicrotasks();

    expect(readProbe()).toMatchObject({
      sort_by: "vote_average.desc",
      with_genres: "28",
      release_date_gte: "2026-02-15",
      release_date_lte: "2026-03-15",
    });

    // Advance across midnight + focus jump to verify continuous rollover without remount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flushMicrotasks();

    expect(readProbe()).toMatchObject({
      sort_by: "vote_average.desc",
      with_genres: "28",
      release_date_gte: "2026-02-16",
      release_date_lte: "2026-03-16",
      with_release_type: "2|3",
    });
    expect(getLatestMediaCallParams(getSpy)).toMatchObject({
      mediaType: "movie",
      sort_by: "vote_average.desc",
      with_genres: "28",
      "release_date.gte": "2026-02-16",
      "release_date.lte": "2026-03-16",
      with_release_type: "2|3",
    });
  });

  it("preserves manually modified and cleared date fields across local midnight rollover", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 23, 59, 50, 0));
    mockedPathname = "/movie/now-playing";
    window.history.replaceState(null, "", "/movie/now-playing");

    const getSpy = mockApiClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const defaults: Filters = {
      sort_by: "popularity.desc",
      with_release_type: "2|3",
    };

    render(
      <QueryClientProvider client={queryClient}>
        <FilterProvider defaultFilters={defaults} datePreset="movie-now-playing">
          <FilterProbe />
          <FilterContainer mediaType="movie" />
          <MediaContainer mediaType="movie" />
        </FilterProvider>
      </QueryClientProvider>
    );

    await flushMicrotasks();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Filter$/i }));
    });
    await flushMicrotasks();

    // Pick a modified start date ("2026-02-10") and clear the end date ("")
    const formattedStartLabel = format(new Date(2026, 1, 15), "PPP");
    const formattedEndLabel = format(new Date(2026, 2, 15), "PPP");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: formattedStartLabel }));
    });
    const feb10Btn = document.querySelector<HTMLButtonElement>('[data-day="2026-02-10"] button');
    expect(feb10Btn).toBeTruthy();
    await act(async () => {
      fireEvent.click(feb10Btn!);
    });

    // Click end date button, then click already-selected 2026-03-15 cell to clear end date
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: formattedEndLabel }));
    });
    const mar15Btn = document.querySelector<HTMLButtonElement>('[data-day="2026-03-15"] button');
    expect(mar15Btn).toBeTruthy();
    await act(async () => {
      fireEvent.click(mar15Btn!);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    });
    await flushMicrotasks();

    expect(readProbe()).toMatchObject({
      release_date_gte: "2026-02-10",
      release_date_lte: "",
    });

    // Roll across local midnight: explicitly modified & cleared dates must stay fixed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flushMicrotasks();

    expect(readProbe()).toMatchObject({
      release_date_gte: "2026-02-10",
      release_date_lte: "",
    });
    expect(getLatestMediaCallParams(getSpy)).toMatchObject({
      "release_date.gte": "2026-02-10",
      "release_date.lte": "",
    });
  });

  it("preserves explicit URL date overrides (even matching Day 1 default) when non-date filters apply, and clears on Reset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 23, 59, 50, 0));
    mockedPathname = "/tv/airing-today";
    // URL explicitly locks air_date_lte=2026-03-15 (which coincides with Day 1 default), leaving air_date_gte unpinned
    window.history.replaceState(null, "", "/tv/airing-today?air_date_lte=2026-03-15");

    mockApiClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const defaults: Filters = { sort_by: "popularity.desc" };
    render(
      <QueryClientProvider client={queryClient}>
        <FilterProvider defaultFilters={defaults} datePreset="tv-airing-today">
          <FilterProbe />
          <FilterContainer mediaType="tv" />
        </FilterProvider>
      </QueryClientProvider>
    );

    await flushMicrotasks();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Filter$/i }));
    });
    await flushMicrotasks();

    // Change only a non-date filter and Apply before midnight
    await selectVoteAverageDesc();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    });
    await flushMicrotasks();

    // Cross local midnight into 2026-03-16
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flushMicrotasks();

    // URL-pinned air_date_lte stays 2026-03-15; unoverridden air_date_gte rolls to 2026-03-16
    expect(readProbe()).toMatchObject({
      sort_by: "vote_average.desc",
      air_date_gte: "2026-03-16",
      air_date_lte: "2026-03-15",
    });

    // Clicking Reset clears both user and URL overrides back to live baseDefaultFilters
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Reset$/i }));
    });
    await flushMicrotasks();

    expect(readProbe()).toMatchObject({
      sort_by: "popularity.desc",
      air_date_gte: "2026-03-16",
      air_date_lte: "2026-03-16",
    });
  });

  it("handles direct partial setFilters updates cleanly: non-date rolls midnight, explicit date pin stays fixed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 23, 59, 50, 0));

    function DirectControlProbe() {
      const { filters, setFilters, resetFilters } = useFilterContext();
      return (
        <div>
          <pre data-testid="direct-probe">
            {JSON.stringify({
              sort_by: filters.sort_by,
              air_date_gte: filters.air_date_gte,
              air_date_lte: filters.air_date_lte,
            })}
          </pre>
          <button
            type="button"
            onClick={() =>
              setFilters({ air_date_lte: "2026-03-15", sort_by: "vote_average.desc" })
            }
          >
            Pin End Date And Sort
          </button>
          <button type="button" onClick={resetFilters}>
            Direct Reset
          </button>
        </div>
      );
    }

    render(
      <FilterProvider defaultFilters={{ sort_by: "popularity.desc" }} datePreset="tv-airing-today">
        <DirectControlProbe />
      </FilterProvider>
    );

    expect(JSON.parse(screen.getByTestId("direct-probe").textContent ?? "{}")).toEqual({
      sort_by: "popularity.desc",
      air_date_gte: "2026-03-15",
      air_date_lte: "2026-03-15",
    });

    // Directly pin air_date_lte to Day 1's date AND update sort_by, leaving air_date_gte untouched
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin End Date And Sort" }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(JSON.parse(screen.getByTestId("direct-probe").textContent ?? "{}")).toEqual({
      sort_by: "vote_average.desc",
      air_date_gte: "2026-03-16",
      air_date_lte: "2026-03-15",
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Direct Reset" }));
    });
    expect(JSON.parse(screen.getByTestId("direct-probe").textContent ?? "{}")).toEqual({
      sort_by: "popularity.desc",
      air_date_gte: "2026-03-16",
      air_date_lte: "2026-03-16",
    });
  });

  it("keeps TV First Air Date switch active without re-enabling air_date at midnight, and clears Reset when reverted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 23, 59, 50, 0));
    mockApiClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    function TvProbe() {
      const { filters } = useFilterContext();
      return (
        <pre data-testid="tv-probe">
          {JSON.stringify({
            sort_by: filters.sort_by,
            air_date_gte: filters.air_date_gte ?? null,
            air_date_lte: filters.air_date_lte ?? null,
            first_air_date_gte: filters.first_air_date_gte ?? null,
            first_air_date_lte: filters.first_air_date_lte ?? null,
          })}
        </pre>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <FilterProvider defaultFilters={{ sort_by: "popularity.desc" }} datePreset="tv-airing-today">
          <TvProbe />
          <FilterContainer mediaType="tv" />
        </FilterProvider>
      </QueryClientProvider>
    );

    await flushMicrotasks();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Filter$/i }));
    });
    await flushMicrotasks();

    // Switch TV date mode to First Air Date and Apply
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "First Air Date" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    });
    await flushMicrotasks();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flushMicrotasks();

    expect(JSON.parse(screen.getByTestId("tv-probe").textContent ?? "{}")).toEqual({
      sort_by: "popularity.desc",
      air_date_gte: null,
      air_date_lte: null,
      first_air_date_gte: "2026-03-15",
      first_air_date_lte: "2026-03-15",
    });

    // Reset back to Air Date preset and confirm Reset disappears once reverted via non-date Apply
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Reset$/i }));
    });
    await flushMicrotasks();

    await selectVoteAverageDesc();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    });
    await flushMicrotasks();
    expect(screen.queryByRole("button", { name: /^Reset$/i })).toBeTruthy();

    // Revert sort_by manually back to popularity.desc and Apply -> Reset button should disappear cleanly
    const sortTrigger = document.getElementById("sort-by-select");
    await act(async () => {
      fireEvent.keyDown(sortTrigger!, { key: "ArrowDown" });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Popularity Descending" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    });
    await flushMicrotasks();
    expect(screen.queryByRole("button", { name: /^Reset$/i })).toBeNull();
  });
});
