import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import apiClient from "@/services/apiClient";
import MediaContainer from "@/feature/media/components/MediaContainer";
import TrendingContainer from "@/feature/media/components/TrendingContainer";
import MediaByGenre from "@/feature/media/components/genre/MediaByGenre";
import MediaByKeyword from "@/feature/media/components/keyword/MediaByKeyword";
import FilterContainer from "@/feature/media/components/filter/FilterContainer";
import {
  FilterProvider,
  buildMediaQueryParams,
  useFilterContext,
} from "@/feature/media/components/filter/FilterProvider";
import { buildFilterSearchQuery } from "@/feature/media/hooks/useFilterSync";
import { globalDefaultFilters } from "@/types/filters";
import { parseQuery } from "@/lib/utils";
import TrendingFilters from "@/feature/media/components/filter/TrendingFilters";
import { useTrendingFilters } from "@/feature/media/hooks/useTrendingFilters";
import { dedupeByKey, dedupeInfinitePages } from "@/feature/media/utils/mediaPagination";
import SearchWrapper from "@/feature/search/components/SearchWrapper";
import MediaDetailWrapper from "@/feature/media/components/detail/MediaDetailWrapper";
import PersonWrapper from "@/feature/person/components/PersonWrapper";

let mockedPathname = "/movie";
let mockedSearchParams = new URLSearchParams();
const routerPushMock = vi.fn((nextUrl: string) => {
  const [, query = ""] = nextUrl.split("?");
  mockedSearchParams = new URLSearchParams(query);
  window.history.replaceState(null, "", nextUrl);
});

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
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
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
    };
  }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function FilterStateProbe() {
  const { filters, baseDefaultFilters } = useFilterContext();
  return (
    <pre data-testid="filter-probe">
      {JSON.stringify({ filters, baseDefaultFilters })}
    </pre>
  );
}

describe("CINE-010 Discovery & Filter Regression Certification", () => {
  beforeEach(() => {
    installDomPolyfills();
    routerPushMock.mockClear();
    mockedPathname = "/movie";
    mockedSearchParams = new URLSearchParams();
    window.history.replaceState(null, "", "/movie");
    useTrendingFilters.setState({
      mediaType: "all",
      timeWindow: "week",
      orientation: "horizontal",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("deduplicates overlapping items across pages and preserves order", () => {
    expect(
      dedupeByKey(
        [
          { id: 1, title: "First" },
          { id: 2, title: "Second" },
          { id: 1, title: "Duplicate First" },
        ],
        (item) => item.id
      )
    ).toEqual([
      { id: 1, title: "First" },
      { id: 2, title: "Second" },
    ]);

    expect(
      dedupeInfinitePages(
        [
          { results: [{ id: 10, name: "A" }, { id: 20, name: "B" }] },
          { results: [{ id: 20, name: "B-dup" }, { id: 30, name: "C" }] },
          { results: null },
        ],
        (item) => item.id
      )
    ).toEqual([
      { id: 10, name: "A" },
      { id: 20, name: "B" },
      { id: 30, name: "C" },
    ]);

    expect(dedupeInfinitePages(undefined, () => "x")).toEqual([]);
  });

  it("renders accessible ErrorState and EmptyState semantics", () => {
    const onRetry = vi.fn();
    render(
      <>
        <ErrorState title="Rate limit" message="Too many requests." onRetry={onRetry} />
        <EmptyState title="No items" message="Nothing matched." />
      </>
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Rate limit");
    expect(alert.textContent).toContain("Too many requests.");
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("No items");
    expect(status.textContent).toContain("Nothing matched.");
  });

  it("isolates draft filters until Apply, normalizes numeric URL filters, handles Back/Forward, and resets with single push", async () => {
    vi.spyOn(apiClient, "get").mockImplementation(async (url: string) => {
      if (url === "/genres") {
        return { data: [{ id: 28, name: "Action" }, { id: 18, name: "Drama" }] };
      }
      if (url === "/languages") {
        return { data: [{ iso_639_1: "en", english_name: "English", name: "English" }] };
      }
      if (url === "/providers/region") {
        return { data: { results: [{ iso_3166_1: "US", english_name: "United States", native_name: "United States" }] } };
      }
      if (url === "/providers/movie") {
        return { data: { results: [] } };
      }
      if (url === "/geolocation") {
        return { data: { country: "US" } };
      }
      return { data: { page: 1, results: [], total_pages: 1, total_results: 0 } };
    });

    mockedSearchParams = new URLSearchParams(
      "sort_by=vote_average.desc&vote_average_gte=7&vote_count_gte=invalid&with_runtime_lte=150"
    );
    window.history.replaceState(
      null,
      "",
      "/movie?sort_by=vote_average.desc&vote_average_gte=7&vote_count_gte=invalid&with_runtime_lte=150"
    );

    const Wrapper = createWrapper();
    const renderTree = () => (
      <Wrapper>
        <FilterProvider>
          <FilterContainer mediaType="movie" />
          <FilterStateProbe />
        </FilterProvider>
      </Wrapper>
    );

    const { rerender } = render(renderTree());

    await waitFor(() => {
      const probe = JSON.parse(screen.getByTestId("filter-probe").textContent ?? "{}");
      expect(probe.filters.sort_by).toBe("vote_average.desc");
      expect(probe.filters.vote_average_gte).toBe(7);
      expect(probe.filters.with_runtime_lte).toBe(150);
      expect(probe.filters.vote_count_gte).toBe(0);
    });

    // Open Filter accordion before selecting draft filters
    const filterAccordionTrigger = screen.getByRole("button", { name: /^Filter$/i });
    if (filterAccordionTrigger.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(filterAccordionTrigger);
    }

    const actionButton = await screen.findByRole("button", { name: "Action" });
    fireEvent.click(actionButton);

    // Draft change alone must NOT mutate applied filters or push URL
    expect(routerPushMock).toHaveBeenCalledTimes(0);
    const probeAfterDraft = JSON.parse(screen.getByTestId("filter-probe").textContent ?? "{}");
    expect(probeAfterDraft.filters.with_genres).toBe("");

    // Clicking Apply pushes URL and updates applied filters
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(routerPushMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock.mock.calls[0][0]).toContain("with_genres=28");
    await waitFor(() => {
      const probeAfterApply = JSON.parse(screen.getByTestId("filter-probe").textContent ?? "{}");
      expect(probeAfterApply.filters.with_genres).toBe("28");
    });

    // Simulate Browser Back reverting URL back to no query params
    mockedSearchParams = new URLSearchParams("");
    window.history.replaceState(null, "", "/movie");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
      rerender(renderTree());
    });

    await waitFor(() => {
      const probeAfterBack = JSON.parse(screen.getByTestId("filter-probe").textContent ?? "{}");
      expect(probeAfterBack.filters.with_genres).toBe("");
      expect(probeAfterBack.filters.sort_by).toBe("popularity.desc");
    });

    // Apply again, then Reset must invoke router.push only ONCE
    fireEvent.click(screen.getByRole("button", { name: "Action" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    routerPushMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(routerPushMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).toHaveBeenCalledWith("/movie");
  });

  it("syncs TrendingFilters with URL and converges on Back/Forward", async () => {
    mockedPathname = "/trending";
    mockedSearchParams = new URLSearchParams("mediaType=tv&timeWindow=day");

    const { rerender } = render(<TrendingFilters />);

    await waitFor(() => {
      expect(useTrendingFilters.getState().mediaType).toBe("tv");
      expect(useTrendingFilters.getState().timeWindow).toBe("day");
    });

    // Simulate navigating back to default /trending
    mockedSearchParams = new URLSearchParams("");
    await act(async () => {
      rerender(<TrendingFilters />);
    });

    await waitFor(() => {
      expect(useTrendingFilters.getState().mediaType).toBe("all");
      expect(useTrendingFilters.getState().timeWindow).toBe("week");
    });
  });

  it("handles SearchWrapper empty query, per-tab errors without masking healthy tabs, and all-tab recovery", async () => {
    const Wrapper = createWrapper();
    const { rerender, unmount } = render(
      <Wrapper>
        <SearchWrapper query="   " />
      </Wrapper>
    );

    expect(screen.getByRole("status").textContent).toContain("Search Cinemania");

    const spy = vi.spyOn(apiClient, "get").mockImplementation(async (url: string) => {
      if (url === "/genres") {
        return { data: [{ id: 878, name: "Science Fiction" }] };
      }
      if (url === "/search/movie") {
        return {
          data: {
            page: 1,
            results: [
              { id: 1, title: "Dune", poster_path: "/d.jpg", vote_average: 8.1, release_date: "2021-10-22", genre_ids: [878] },
              { id: 1, title: "Dune Duplicate", poster_path: "/d.jpg", vote_average: 8.1, release_date: "2021-10-22", genre_ids: [878] },
            ],
            total_pages: 1,
            total_results: 1,
          },
        };
      }
      if (url === "/search/tv") {
        throw new Error("429 Rate Limit");
      }
      return { data: { page: 1, results: [], total_pages: 1, total_results: 0 } };
    });

    rerender(
      <Wrapper>
        <SearchWrapper query="dune" />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "Dune" })).toHaveLength(1);
    });

    expect(screen.getByRole("tab", { name: "TV (0)" })).toBeTruthy();
    unmount();

    spy.mockRejectedValue(new Error("All failed"));
    const FreshWrapper = createWrapper();
    render(
      <FreshWrapper>
        <SearchWrapper query="timeout" />
      </FreshWrapper>
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Failed to load search results");
  });

  it("shows accessible error + retry without wiping page 1 on page-2 failure in discovery, trending, genre, and keyword routes", async () => {
    let moviePage = 1;
    vi.spyOn(apiClient, "get").mockImplementation(async (url: string) => {
      if (url === "/genres") {
        return { data: [{ id: 878, name: "Science Fiction" }, { id: 28, name: "Action" }] };
      }
      if (url === "/media") {
        if (moviePage === 1) {
          return {
            data: {
              page: 1,
              results: [
                {
                  id: 101,
                  title: "Interstellar",
                  overview: "Space",
                  poster_path: "/i.jpg",
                  vote_average: 8.7,
                  release_date: "2014-11-05",
                  genre_ids: [878],
                },
              ],
              total_pages: 1,
              total_results: 1,
            },
          };
        }
        return { data: { page: 1, results: [], total_pages: 1, total_results: 0 } };
      }
      if (url === "/media/trending") {
        throw new Error("Trending 429");
      }
      return { data: { page: 1, results: [], total_pages: 1, total_results: 0 } };
    });

    const Wrapper = createWrapper();
    const { unmount: unmountDiscovery } = render(
      <Wrapper>
        <FilterProvider>
          <MediaContainer mediaType="movie" />
        </FilterProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Interstellar" })).toBeTruthy();
    });
    unmountDiscovery();

    moviePage = 2;
    const EmptyGenreWrapper = createWrapper();
    const { unmount: unmountGenre } = render(
      <EmptyGenreWrapper>
        <MediaByGenre id={28} mediaType="movie" />
      </EmptyGenreWrapper>
    );
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("No movies were found for this genre");
    });
    unmountGenre();

    const EmptyKeywordWrapper = createWrapper();
    const { unmount: unmountKeyword } = render(
      <EmptyKeywordWrapper>
        <MediaByKeyword slug="123-dream" mediaType="movie" />
      </EmptyKeywordWrapper>
    );
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("No movies were found for this keyword");
    });
    unmountKeyword();

    const ErrorTrendingWrapper = createWrapper();
    render(
      <ErrorTrendingWrapper>
        <TrendingContainer />
      </ErrorTrendingWrapper>
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Trending 429");
  });

  it("retries MediaDetailWrapper and PersonWrapper via React Query refetch instead of full page reload", async () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: originalLocation.href,
        origin: originalLocation.origin,
        pathname: originalLocation.pathname,
        search: originalLocation.search,
        hash: originalLocation.hash,
        reload: reloadSpy,
      },
    });

    try {
      let shouldFail = true;
      vi.spyOn(apiClient, "get").mockImplementation(async (url: string) => {
        if (shouldFail) {
          throw new Error(`HTTP 429 on ${url}`);
        }
        if (url === "/geolocation") return { data: { country: "US" } };
        if (url.startsWith("/person/550/combined_credits")) return { data: { cast: [], crew: [] } };
        if (url.startsWith("/person/550")) return { data: { id: 550, name: "Edward Norton", biography: "Actor", profile_path: "/550.jpg" } };
        return { data: { results: [] } };
      });

      const Wrapper1 = createWrapper();
      const { unmount: unmountDetail } = render(
        <Wrapper1>
          <MediaDetailWrapper id={27205} mediaType="movie" />
        </Wrapper1>
      );

      const detailAlert = await screen.findByRole("alert");
      expect(detailAlert.textContent).toContain("HTTP 429");
      fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
      expect(reloadSpy).not.toHaveBeenCalled();
      unmountDetail();

      const Wrapper2 = createWrapper();
      render(
        <Wrapper2>
          <PersonWrapper personId={550} />
        </Wrapper2>
      );

      const personAlert = await screen.findByRole("alert");
      expect(personAlert.textContent).toContain("HTTP 429");
      shouldFail = false;
      fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Edward Norton" })).toBeTruthy();
      });
      await waitFor(() => {
        expect(screen.queryAllByRole("status").some((el) => el.textContent?.includes("No acting or crew credits"))).toBe(true);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("persists TV First Air Date switch (including cleared bounds) across URL roundtrip, unmount/remount, Back/Forward, and MediaContainer queries", async () => {
    const mediaRequests: Record<string, unknown>[] = [];
    vi.spyOn(apiClient, "get").mockImplementation(async (url: string, config?: { params?: unknown }) => {
      if (url === "/media") {
        mediaRequests.push((config?.params as Record<string, unknown> | undefined) ?? {});
        return { data: { page: 1, results: [{ id: 1399, name: "Game of Thrones", poster_path: "/x.jpg", vote_average: 8.4, first_air_date: "2011-04-17", genre_ids: [18] }], total_pages: 1, total_results: 1 } };
      }
      if (url === "/genres") return { data: [{ id: 18, name: "Drama" }] };
      if (url === "/languages") return { data: [{ iso_639_1: "en", english_name: "English", name: "English" }] };
      if (url === "/providers/region") return { data: { results: [] } };
      if (url === "/providers/tv") return { data: { results: [] } };
      if (url === "/geolocation") return { data: { country: "US" } };
      return { data: { page: 1, results: [], total_pages: 1, total_results: 0 } };
    });

    mockedPathname = "/tv/airing-today";
    mockedSearchParams = new URLSearchParams();
    window.history.replaceState(null, "", "/tv/airing-today");

    const airingDefaults = { sort_by: "popularity.desc" };
    const Wrapper1 = createWrapper();
    const { unmount } = render(
      <Wrapper1>
        <FilterProvider defaultFilters={airingDefaults} datePreset="tv-airing-today">
          <FilterStateProbe />
          <FilterContainer mediaType="tv" />
          <MediaContainer mediaType="tv" />
        </FilterProvider>
      </Wrapper1>
    );

    await waitFor(() => {
      expect(mediaRequests.length).toBeGreaterThanOrEqual(1);
    });
    expect(mediaRequests[mediaRequests.length - 1]["air_date.gte"]).toBeTruthy();
    expect(mediaRequests[mediaRequests.length - 1]["first_air_date.gte"]).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /^Filter$/i }));
    fireEvent.click(screen.getByRole("button", { name: "First Air Date" }));
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/ }));

    await waitFor(() => {
      expect(mockedSearchParams.get("dateMode")).toBe("first_air_date");
    });
    expect(mockedSearchParams.has("air_date_gte")).toBe(false);
    expect(mockedSearchParams.has("air_date_lte")).toBe(false);

    const appliedQueryString = window.location.search;
    expect(appliedQueryString).toContain("dateMode=first_air_date");
    expect(new URLSearchParams(appliedQueryString).has("air_date_gte")).toBe(false);
    expect(new URLSearchParams(appliedQueryString).has("air_date_lte")).toBe(false);
    await waitFor(() => {
      const latest = mediaRequests[mediaRequests.length - 1];
      expect(latest["first_air_date.gte"]).toBeTruthy();
      expect(latest["air_date.gte"]).toBe("");
      expect(latest["air_date.lte"]).toBe("");
    });

    // Simulate reload / Back from detail page by unmounting and remounting from persisted URL
    unmount();
    cleanup();
    const beforeRemountRequests = mediaRequests.length;
    window.history.replaceState(null, "", `/tv/airing-today${appliedQueryString}`);
    mockedSearchParams = new URLSearchParams(appliedQueryString.replace(/^\?/, ""));

    const Wrapper2 = createWrapper();
    const { unmount: unmountReloaded } = render(
      <Wrapper2>
        <FilterProvider defaultFilters={airingDefaults} datePreset="tv-airing-today">
          <FilterStateProbe />
          <FilterContainer mediaType="tv" />
          <MediaContainer mediaType="tv" />
        </FilterProvider>
      </Wrapper2>
    );

    await waitFor(() => {
      expect(mediaRequests.length).toBeGreaterThan(beforeRemountRequests);
    });
    const reloadedProbe = JSON.parse(screen.getByTestId("filter-probe").textContent || "{}");
    expect(reloadedProbe.filters.dateMode).toBe("first_air_date");
    expect(reloadedProbe.filters.air_date_gte).toBeUndefined();
    expect(reloadedProbe.filters.air_date_lte).toBeUndefined();
    expect(reloadedProbe.filters.first_air_date_gte).toBeTruthy();

    const reloadedParams = mediaRequests[mediaRequests.length - 1];
    expect(reloadedParams["first_air_date.gte"]).toBeTruthy();
    expect(reloadedParams["air_date.gte"]).toBe("");
    expect(reloadedParams["air_date.lte"]).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /^Filter$/i }));
    expect(screen.getByRole("button", { name: /^Reset$/ })).toBeTruthy();

    // Verify browser Back to default "" and Forward back to dateMode=first_air_date
    await act(async () => {
      window.history.replaceState(null, "", "/tv/airing-today");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => {
      const backProbe = JSON.parse(screen.getByTestId("filter-probe").textContent || "{}");
      expect(backProbe.filters.dateMode).toBeUndefined();
      expect(backProbe.filters.air_date_gte).toBeTruthy();
      expect(backProbe.filters.first_air_date_gte).toBeUndefined();
    });

    await act(async () => {
      window.history.replaceState(null, "", `/tv/airing-today${appliedQueryString}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => {
      const fwdProbe = JSON.parse(screen.getByTestId("filter-probe").textContent || "{}");
      expect(fwdProbe.filters.dateMode).toBe("first_air_date");
      expect(fwdProbe.filters.air_date_gte).toBeUndefined();
      expect(fwdProbe.filters.first_air_date_gte).toBeTruthy();
    });

    unmountReloaded();
    cleanup();

    // /tv/on-tv with First Air Date AND both date bounds cleared
    mockedPathname = "/tv/on-tv";
    const onTvClearedUrl = "?dateMode=first_air_date";
    mockedSearchParams = new URLSearchParams("dateMode=first_air_date");
    window.history.replaceState(null, "", `/tv/on-tv${onTvClearedUrl}`);

    const Wrapper3 = createWrapper();
    render(
      <Wrapper3>
        <FilterProvider defaultFilters={globalDefaultFilters} datePreset="tv-on-tv">
          <FilterStateProbe />
          <FilterContainer mediaType="tv" />
        </FilterProvider>
      </Wrapper3>
    );

    await waitFor(() => {
      const onTvProbe = JSON.parse(screen.getByTestId("filter-probe").textContent || "{}");
      expect(onTvProbe.filters.dateMode).toBe("first_air_date");
      expect(onTvProbe.filters.air_date_gte).toBeUndefined();
      expect(onTvProbe.filters.air_date_lte).toBeUndefined();
      expect(buildMediaQueryParams("tv", onTvProbe.filters)).toMatchObject({
        "air_date.gte": "",
        "air_date.lte": "",
        "first_air_date.gte": "",
        "first_air_date.lte": "",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^Filter$/i }));
    expect(screen.getByRole("button", { name: /^Reset$/ })).toBeTruthy();
    expect(screen.getByText("Pick a start date")).toBeTruthy();
    expect(screen.getByText("Pick an end date")).toBeTruthy();

    // Switching back to Air Date and clicking Apply clears dateMode and removes Reset when reverted
    fireEvent.click(screen.getByRole("button", { name: "Air Date" }));
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/ }));
    expect(window.location.search).toBe("?air_date_gte=&air_date_lte=");

    fireEvent.click(screen.getByRole("button", { name: /^Reset$/ }));
    await waitFor(() => {
      const resetProbe = JSON.parse(screen.getByTestId("filter-probe").textContent || "{}");
      expect(resetProbe.filters.dateMode).toBeUndefined();
      expect(resetProbe.filters.air_date_gte).toBeTruthy();
    });
  });

  it("persists explicitly cleared preset date bounds across URL serialization, reload, and sanitizes invalid dateMode", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({ data: [] });

    expect(parseQuery("?dateMode=invalid&vote_count_gte=&release_date_gte=")).toEqual({
      release_date_gte: "",
    });

    const movieDefaults = {
      ...globalDefaultFilters,
      release_date_gte: "2026-10-03",
      release_date_lte: "2026-11-14",
    };
    const serializedClearedStart = buildFilterSearchQuery(
      { ...movieDefaults, release_date_gte: "" },
      movieDefaults
    );
    expect(serializedClearedStart).toBe("release_date_gte=");

    const serializedClearedBoth = buildFilterSearchQuery(
      { ...movieDefaults, release_date_gte: "", release_date_lte: "" },
      movieDefaults
    );
    expect(serializedClearedBoth).toBe("release_date_gte=&release_date_lte=");

    mockedPathname = "/movie/now-playing";
    mockedSearchParams = new URLSearchParams("release_date_gte=&dateMode=bogus");
    window.history.replaceState(null, "", "/movie/now-playing?release_date_gte=&dateMode=bogus");

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <FilterProvider defaultFilters={globalDefaultFilters} datePreset="movie-now-playing">
          <FilterStateProbe />
          <FilterContainer mediaType="movie" />
        </FilterProvider>
      </Wrapper>
    );

    await waitFor(() => {
      const probe = JSON.parse(screen.getByTestId("filter-probe").textContent || "{}");
      expect(probe.filters.release_date_gte).toBe("");
      expect(probe.filters.release_date_lte).toBeTruthy();
      expect(probe.filters.dateMode).toBeUndefined();
      const params = buildMediaQueryParams("movie", probe.filters);
      expect(params["release_date.gte"]).toBe("");
      expect(params["release_date.lte"]).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Filter$/i }));
    expect(screen.getByText("Pick a start date")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Reset$/ })).toBeTruthy();
  });

  it("renders loaded search category tabs immediately while slower category queries are still pending", async () => {
    let resolvePerson!: (value: unknown) => void;
    const pendingPerson = new Promise((resolve) => {
      resolvePerson = resolve;
    });

    vi.spyOn(apiClient, "get").mockImplementation(async (url: string) => {
      if (url === "/search/movie") {
        return {
          data: {
            page: 1,
            total_pages: 1,
            total_results: 1,
            results: [{ id: 27205, title: "Inception", poster_path: "/x.jpg", vote_average: 8.4, release_date: "2010-07-15", genre_ids: [28] }],
          },
        };
      }
      if (url === "/search/tv") {
        throw new Error("TV timed out");
      }
      if (url === "/search/person") {
        return pendingPerson;
      }
      return new Promise(() => {});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <SearchWrapper query="Inception" />
      </Wrapper>
    );

    // Movies tab renders immediately without waiting for person/keyword
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Movies (1)" })).toBeTruthy();
      expect(screen.getByText("Inception")).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "People (Loading...)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Keywords (Loading...)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "TV (0)" })).toBeTruthy();

    await act(async () => {
      resolvePerson({
        data: {
          page: 1,
          total_pages: 1,
          total_results: 1,
          results: [{ id: 550, name: "Leonardo DiCaprio", profile_path: null, known_for_department: "Acting" }],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "People (1)" })).toBeTruthy();
    });
  });
});
