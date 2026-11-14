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
import { FilterProvider, useFilterContext } from "@/feature/media/components/filter/FilterProvider";
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
});
