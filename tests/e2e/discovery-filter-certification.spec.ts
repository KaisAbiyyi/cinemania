import { expect, test, type Page, type Route } from "@playwright/test";

const SAMPLE_GENRES = [
  { id: 28, name: "Action" },
  { id: 18, name: "Drama" },
];

const PAGE_1_MOVIES = {
  page: 1,
  total_pages: 2,
  total_results: 3,
  results: [
    {
      id: 27205,
      title: "Inception",
      overview: "Mind heist.",
      poster_path: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
      backdrop_path: "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
      release_date: "2010-07-15",
      vote_average: 8.4,
      vote_count: 35000,
      genre_ids: [28],
    },
    {
      id: 550,
      title: "Fight Club",
      overview: "First rule.",
      poster_path: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
      backdrop_path: "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
      release_date: "1999-10-15",
      vote_average: 8.4,
      vote_count: 28000,
      genre_ids: [18],
    },
  ],
};

const SINGLE_PAGE_MOVIES = {
  ...PAGE_1_MOVIES,
  total_pages: 1,
  total_results: 2,
};

const PAGE_2_WITH_OVERLAP = {
  page: 2,
  total_pages: 2,
  total_results: 3,
  results: [
    // Deliberate duplicate of Fight Club across page boundary to certify deduplication
    {
      id: 550,
      title: "Fight Club",
      overview: "First rule.",
      poster_path: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
      backdrop_path: "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
      release_date: "1999-10-15",
      vote_average: 8.4,
      vote_count: 28000,
      genre_ids: [18],
    },
    {
      id: 680,
      title: "Pulp Fiction",
      overview: "Vega and Jules.",
      poster_path: "/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg",
      backdrop_path: "/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg",
      release_date: "1994-09-10",
      vote_average: 8.5,
      vote_count: 27000,
      genre_ids: [18],
    },
  ],
};

const ACTION_FILTERED_MOVIES = {
  page: 1,
  total_pages: 1,
  total_results: 1,
  results: [
    {
      id: 27205,
      title: "Inception",
      overview: "Mind heist.",
      poster_path: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
      backdrop_path: "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
      release_date: "2010-07-15",
      vote_average: 8.4,
      vote_count: 35000,
      genre_ids: [28],
    },
  ],
};

function visibleAlertLocator(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

async function installFilterControlMocks(page: Page) {
  await page.route("**/api/genres**", (route) =>
    route.fulfill({ json: SAMPLE_GENRES })
  );
  await page.route("**/api/languages**", (route) =>
    route.fulfill({
      json: [{ iso_639_1: "en", english_name: "English", name: "English" }],
    })
  );
  await page.route("**/api/providers/**", (route) =>
    route.fulfill({
      json: {
        results: [{ iso_3166_1: "US", english_name: "United States", native_name: "United States", provider_id: 8, provider_name: "Netflix", logo_path: "/n.jpg" }],
      },
    })
  );
  await page.route("**/api/geolocation**", (route) =>
    route.fulfill({ json: { country: "US" } })
  );
  await page.route("**/api/keywords**", (route) =>
    route.fulfill({ json: { page: 1, results: [], total_pages: 1, total_results: 0 } })
  );
}

async function openFiltersIfCollapsed(page: Page) {
  const applyButton = page.getByRole("button", { name: "Apply", exact: true });
  if (!(await applyButton.isVisible())) {
    await page.getByRole("button", { name: /^Filter$/i }).click();
  }
  await expect(applyButton).toBeVisible();
}

async function clearDateBound(page: Page, boundIndex: 0 | 1) {
  const dateSection = page.locator("div.flex.flex-col.gap-2", {
    has: page.getByText("Release Date Range", { exact: true }),
  });
  await dateSection.locator("button").nth(boundIndex).click();
  const dialog = page.locator('[role="dialog"]').last();
  await expect(dialog).toBeVisible();
  await dialog
    .locator('[data-selected="true"] button, button[aria-selected="true"]')
    .first()
    .click();
  await page.keyboard.press("Escape");
}

test.describe("CINE-010: Discovery, filter, pagination & error certification", () => {
  test("does not fetch on draft edits until explicit Apply is clicked on /movie", async ({ page }) => {
    await installFilterControlMocks(page);
    const mediaRequests: string[] = [];

    await page.route("**/api/media?*", async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/media") {
        await route.continue();
        return;
      }
      mediaRequests.push(url.search);
      if (url.searchParams.get("with_genres") === "28") {
        await route.fulfill({ json: ACTION_FILTERED_MOVIES });
      } else {
        await route.fulfill({ json: SINGLE_PAGE_MOVIES });
      }
    });

    await page.goto("/movie");
    await expect(page.locator("article h2", { hasText: "Fight Club" })).toBeVisible();
    const initialCount = mediaRequests.length;
    expect(initialCount).toBe(1);

    await openFiltersIfCollapsed(page);
    const actionBtn = page.getByRole("button", { name: "Action", exact: true });
    await actionBtn.click();

    // Wait briefly and confirm draft edits neither mutate the URL nor fire extra /api/media fetches
    await page.waitForTimeout(300);
    expect(mediaRequests).toHaveLength(initialCount);
    expect(page.url()).not.toContain("with_genres=28");

    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/with_genres=28/);
    await expect.poll(() => mediaRequests.length).toBe(initialCount + 1);
    expect(mediaRequests[mediaRequests.length - 1]).toContain("with_genres=28");
    await expect(page.locator("article h2", { hasText: "Inception" })).toBeVisible();
    await expect(page.locator("article h2", { hasText: "Fight Club" })).toHaveCount(0);
  });

  test("deduplicates overlapping page-2 infinite scroll items and halts+recovers on 429 page-2 failure", async ({ page }) => {
    await installFilterControlMocks(page);
    const page2Urls: string[] = [];
    let failPage2Once = false;

    await page.route("**/api/media?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/media") {
        await route.continue();
        return;
      }
      const pageParam = url.searchParams.get("page") || "1";
      if (pageParam === "2") {
        page2Urls.push(url.search);
        if (failPage2Once) {
          failPage2Once = false;
          await route.fulfill({
            status: 429,
            json: { error: "Too Many Requests" },
          });
          return;
        }
        await route.fulfill({ json: PAGE_2_WITH_OVERLAP });
        return;
      }
      await route.fulfill({ json: PAGE_1_MOVIES });
    });

    await page.goto("/movie");
    await expect(page.locator("article h2", { hasText: "Pulp Fiction" })).toBeVisible();

    // Only one page=2 fetch and duplicate id=550 ("Fight Club") must render once
    expect(page2Urls).toHaveLength(1);
    await expect(page.locator("article h2", { hasText: "Fight Club" })).toHaveCount(1);
    await expect(page.locator("article")).toHaveCount(3);

    // Now test page-2 HTTP 429 halt + accessible retry recovery on /tv
    page2Urls.length = 0;
    failPage2Once = true;

    await page.goto("/tv");
    const nextPageAlert = visibleAlertLocator(page);
    await expect(nextPageAlert).toContainText("Failed to load more results");
    // Page 1 cards must remain visible while page-2 failed
    await expect(page.locator("article")).toHaveCount(2);

    await page.waitForTimeout(250);
    // IntersectionObserver must not loop when page 2 errored
    expect(page2Urls).toHaveLength(1);

    await nextPageAlert.getByRole("button", { name: "Try Again" }).click();
    await expect(page.locator("article h2", { hasText: "Pulp Fiction" })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(3);
  });

  test("retains URL filter selections across detail navigation, Back/Forward, and Trending route navigation", async ({ page }) => {
    await installFilterControlMocks(page);

    await page.route("**/api/media?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/media") {
        await route.continue();
        return;
      }
      if (url.searchParams.get("with_genres") === "28") {
        await route.fulfill({ json: ACTION_FILTERED_MOVIES });
      } else {
        await route.fulfill({ json: SINGLE_PAGE_MOVIES });
      }
    });

    await page.route("**/api/media/27205**", (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (path.endsWith("/credits")) {
        return route.fulfill({ json: { id: 27205, cast: [], crew: [] } });
      }
      if (path.endsWith("/release_dates")) {
        return route.fulfill({ json: { id: 27205, results: [] } });
      }
      if (path.endsWith("/keywords")) {
        return route.fulfill({ json: { id: 27205, keywords: [] } });
      }
      if (path.endsWith("/images")) {
        return route.fulfill({ json: { id: 27205, backdrops: [], posters: [] } });
      }
      if (path.endsWith("/reviews") || path.endsWith("/recommendations") || path.endsWith("/similar")) {
        return route.fulfill({ json: { id: 27205, page: 1, results: [], total_pages: 0, total_results: 0 } });
      }
      if (path.endsWith("/videos")) {
        return route.fulfill({ json: { id: 27205, results: [] } });
      }
      return route.fulfill({
        json: {
          id: 27205,
          title: "Inception",
          overview: "Mind heist.",
          poster_path: "/o.jpg",
          backdrop_path: "/b.jpg",
          release_date: "2010-07-15",
          vote_average: 8.4,
          vote_count: 35000,
          genres: [{ id: 28, name: "Action" }],
          runtime: 148,
          status: "Released",
          tagline: "Your mind is the scene of the crime.",
        },
      });
    });

    await page.goto("/movie");
    await openFiltersIfCollapsed(page);
    await page.getByRole("button", { name: "Action", exact: true }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/with_genres=28/);

    // Navigate into detail route
    await page.locator("article a").first().click();
    await expect(page).toHaveURL(/\/movie\/27205-/);
    await expect(page.getByRole("heading", { name: "Inception" })).toBeVisible();

    // Browser Back must preserve filter URL & selected filter state
    await page.goBack();
    await expect(page).toHaveURL(/\/movie\?.*with_genres=28/);
    await expect(page.locator("article")).toHaveCount(1);

    // Reload retains URL filters
    await page.reload();
    await expect(page).toHaveURL(/\/movie\?.*with_genres=28/);
    await expect(page.locator("article")).toHaveCount(1);

    // Trending filter URL persistence + Back/Forward
    await page.route("**/api/media/trending**", (route) =>
      route.fulfill({ json: SINGLE_PAGE_MOVIES })
    );
    await page.goto("/trending");
    await page.getByLabel("Trending media type").click();
    await page.getByRole("option", { name: "Movies" }).click();
    await expect(page).toHaveURL(/\/trending\?mediaType=movie/);

    await page.getByLabel("Trending time window").click();
    await page.getByRole("option", { name: "Day" }).click();
    await expect(page).toHaveURL(/mediaType=movie&timeWindow=day/);

    await page.goBack();
    await expect(page).toHaveURL(/\/trending\?mediaType=movie$/);
    await expect(page.getByLabel("Trending time window")).toContainText("Week");

    await page.goForward();
    await expect(page).toHaveURL(/timeWindow=day/);
    await expect(page.getByLabel("Trending time window")).toContainText("Day");
  });

  test("displays accessible no-results & empty states across discovery, search, genre, keyword, trending, and detail routes", async ({ page }) => {
    await installFilterControlMocks(page);
    const emptyPaginated = { page: 1, results: [], total_pages: 0, total_results: 0 };

    await page.route("**/api/media?*", (route) => route.fulfill({ json: emptyPaginated }));
    await page.route("**/api/media/trending**", (route) => route.fulfill({ json: emptyPaginated }));
    await page.route("**/api/search/**", (route) => route.fulfill({ json: emptyPaginated }));
    await page.route("**/api/media/27205**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/credits")) {
        return route.fulfill({ json: { id: 27205, cast: [], crew: [] } });
      }
      return route.fulfill({
        json: {
          id: 27205,
          title: "Inception",
          overview: "",
          poster_path: "",
          backdrop_path: "",
          release_date: "2010-07-15",
          vote_average: 8.4,
          vote_count: 1,
          genres: [],
          runtime: 148,
          status: "Released",
          tagline: "",
        },
      });
    });

    await page.goto("/movie");
    await expect(page.getByRole("status").filter({ hasText: "No results found" })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);

    await page.goto("/trending");
    await expect(page.getByRole("status").filter({ hasText: "No trending results" })).toBeVisible();

    await page.goto("/genre/28-action/movie");
    await expect(
      page.getByRole("status").filter({ hasText: "No movies were found for this genre" })
    ).toBeVisible();

    await page.goto("/keyword/123-dream/movie");
    await expect(
      page.getByRole("status").filter({ hasText: "No movies were found for this keyword" })
    ).toBeVisible();

    // Empty /search route with no query should show accessible empty state, not error
    await page.goto("/search");
    await expect(page.getByRole("status").filter({ hasText: "Search Cinemania" })).toBeVisible();

    // /search with 0 results
    await page.goto("/search?q=nonexistenttitle999");
    await expect(page.getByRole("tab", { name: /Movies \(0\)/i })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: 'No movies matched "nonexistenttitle999"' })
    ).toBeVisible();

    // Detail subview /cast empty
    await page.goto("/movie/27205-inception/cast");
    await expect(page.getByRole("status").filter({ hasText: "No cast or crew" })).toBeVisible();
  });

  test("handles 429 and timeout failures gracefully with accessible retry recovery without full reload", async ({ page }) => {
    await installFilterControlMocks(page);

    let failDiscovery = true;
    let discoveryAttempts = 0;
    await page.route("**/api/media?*", async (route) => {
      discoveryAttempts += 1;
      if (failDiscovery) {
        await route.fulfill({ status: 429, json: { error: "Rate limit exceeded" } });
      } else {
        await route.fulfill({ json: SINGLE_PAGE_MOVIES });
      }
    });

    await page.goto("/movie");
    const discoveryAlert = visibleAlertLocator(page);
    await expect(discoveryAlert).toBeVisible();
    expect(discoveryAttempts).toBe(1);
    failDiscovery = false;
    await discoveryAlert.getByRole("button", { name: "Try Again" }).click();
    await expect(page.locator("article h2", { hasText: "Inception" })).toBeVisible();

    // Simulate network abort/timeout on /search
    let abortSearch = true;
    await page.route("**/api/search/**", async (route) => {
      if (abortSearch) {
        await route.abort("timedout");
      } else if (new URL(route.request().url()).pathname === "/api/search/movie") {
        await route.fulfill({ json: SINGLE_PAGE_MOVIES });
      } else {
        await route.fulfill({ json: { page: 1, results: [], total_pages: 0, total_results: 0 } });
      }
    });

    await page.goto("/search?q=inception");
    const searchAlert = visibleAlertLocator(page);
    await expect(searchAlert).toContainText("Failed to load search results");
    abortSearch = false;
    await searchAlert.getByRole("button", { name: "Try Again" }).click();
    await expect(page.locator("article h2", { hasText: "Inception" })).toBeVisible();

    // Detail route recovery without full page reload
    let failPerson = true;
    await page.route("**/api/person/550**", async (route) => {
      if (failPerson) {
        await route.fulfill({ status: 429, json: { error: "Rate limit" } });
      } else if (route.request().url().includes("combined_credits")) {
        await route.fulfill({ json: { cast: [], crew: [] } });
      } else if (route.request().url().includes("/images")) {
        await route.fulfill({ json: { id: 550, profiles: [] } });
      } else {
        await route.fulfill({
          json: {
            id: 550,
            name: "Edward Norton",
            biography: "Actor",
            profile_path: "/550.jpg",
            known_for_department: "Acting",
          },
        });
      }
    });

    await page.goto("/person/550-edward-norton");
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__noFullReloadMarker = "preserved";
    });
    const personAlert = visibleAlertLocator(page).first();
    await expect(personAlert).toBeVisible();
    failPerson = false;
    await personAlert.getByRole("button", { name: "Try Again" }).click();
    await expect(page.getByRole("heading", { name: "Edward Norton" })).toBeVisible();
    const marker = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__noFullReloadMarker
    );
    expect(marker).toBe("preserved");
  });

  test("supports mobile viewport filter drawer, explicit Apply, and infinite scroll cleanly", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installFilterControlMocks(page);

    const mediaRequests: string[] = [];
    await page.route("**/api/media?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/media") {
        await route.continue();
        return;
      }
      mediaRequests.push(url.search);
      const pageParam = url.searchParams.get("page") || "1";
      if (url.searchParams.get("with_genres") === "28") {
        await route.fulfill({ json: pageParam === "2" ? PAGE_2_WITH_OVERLAP : PAGE_1_MOVIES });
      } else {
        await route.fulfill({ json: SINGLE_PAGE_MOVIES });
      }
    });

    await page.goto("/movie");
    await expect(page.locator("article")).toHaveCount(2);
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2
    );
    expect(hasHorizontalOverflow).toBe(false);

    await openFiltersIfCollapsed(page);
    await page.getByRole("button", { name: "Action", exact: true }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/with_genres=28/);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator("article h2", { hasText: "Pulp Fiction" })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(3);
  });

  test("TV presets persist First Air Date switch (and cleared bounds) across reload, detail Back, and Forward without dual date params", async ({ page }) => {
    await installFilterControlMocks(page);

    const mediaRequests: URLSearchParams[] = [];
    await page.route("**/api/media?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/media") {
        await route.continue();
        return;
      }
      mediaRequests.push(url.searchParams);
      await route.fulfill({
        json: {
          page: 1,
          total_pages: 1,
          total_results: 1,
          results: [
            {
              id: 1399,
              name: "Game of Thrones",
              overview: "Winter is coming.",
              poster_path: "/x.jpg",
              backdrop_path: "/y.jpg",
              first_air_date: "2011-04-17",
              vote_average: 8.4,
              vote_count: 1000,
              genre_ids: [18],
            },
          ],
        },
      });
    });

    await page.route("**/api/media/1399**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/credits")) {
        return route.fulfill({ json: { id: 1399, cast: [], crew: [] } });
      }
      if (path.endsWith("/keywords")) {
        return route.fulfill({ json: { id: 1399, results: [] } });
      }
      if (path.endsWith("/images")) {
        return route.fulfill({ json: { id: 1399, backdrops: [], posters: [] } });
      }
      if (path.endsWith("/videos") || path.endsWith("/content_ratings")) {
        return route.fulfill({ json: { id: 1399, results: [] } });
      }
      if (path.endsWith("/reviews") || path.endsWith("/recommendations") || path.endsWith("/similar")) {
        return route.fulfill({ json: { id: 1399, page: 1, results: [], total_pages: 0, total_results: 0 } });
      }
      return route.fulfill({
        json: {
          id: 1399,
          name: "Game of Thrones",
          overview: "Winter is coming.",
          poster_path: "/x.jpg",
          backdrop_path: "/y.jpg",
          first_air_date: "2011-04-17",
          vote_average: 8.4,
          vote_count: 1000,
          genres: [{ id: 18, name: "Drama" }],
          episode_run_time: [60],
          number_of_seasons: 8,
          number_of_episodes: 73,
          status: "Ended",
          tagline: "",
        },
      });
    });

    // 1. /tv/airing-today: switch Air Date -> First Air Date, Apply -> Reload -> Detail -> Back -> Forward
    await page.goto("/tv/airing-today");
    await expect(page.locator("article h2", { hasText: "Game of Thrones" })).toBeVisible();
    const initialParams = mediaRequests[mediaRequests.length - 1];
    expect(initialParams.get("air_date.gte")).toBeTruthy();
    expect(initialParams.get("first_air_date.gte") ?? "").toBe("");

    await openFiltersIfCollapsed(page);
    await page.getByRole("button", { name: "First Air Date", exact: true }).click();
    const applyBeforeRequests = mediaRequests.length;
    await page.getByRole("button", { name: "Apply", exact: true }).click();

    await expect(page).toHaveURL(/\/tv\/airing-today\?.*dateMode=first_air_date/);
    await expect(page).not.toHaveURL(/(?:^|[?&])air_date_gte=/);
    await expect(page).not.toHaveURL(/(?:^|[?&])air_date_lte=/);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(applyBeforeRequests);
    const appliedParams = mediaRequests[mediaRequests.length - 1];
    expect(appliedParams.get("first_air_date.gte")).toBeTruthy();
    expect(appliedParams.get("first_air_date.lte")).toBeTruthy();
    expect(appliedParams.get("air_date.gte") ?? "").toBe("");
    expect(appliedParams.get("air_date.lte") ?? "").toBe("");

    // Reload preserves dateMode=first_air_date and suppresses air_date.*
    const beforeReloadCount = mediaRequests.length;
    await page.reload();
    await expect(page.locator("article h2", { hasText: "Game of Thrones" })).toBeVisible();
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeReloadCount);
    const reloadedParams = mediaRequests[mediaRequests.length - 1];
    expect(reloadedParams.get("first_air_date.gte")).toBeTruthy();
    expect(reloadedParams.get("air_date.gte") ?? "").toBe("");
    expect(reloadedParams.get("air_date.lte") ?? "").toBe("");

    // Detail navigation + browser Back keeps First Air Date mode intact
    await page.locator("article a").first().click();
    await expect(page).toHaveURL(/\/tv\/1399-/);
    await expect(page.getByRole("heading", { name: "Game of Thrones" })).toBeVisible();

    const beforeBackCount = mediaRequests.length;
    await page.goBack();
    await expect(page).toHaveURL(/\/tv\/airing-today\?.*dateMode=first_air_date/);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeBackCount);
    const backFromDetailParams = mediaRequests[mediaRequests.length - 1];
    expect(backFromDetailParams.get("first_air_date.gte")).toBeTruthy();
    expect(backFromDetailParams.get("air_date.gte") ?? "").toBe("");

    // Browser Back to untouched /tv/airing-today, then Forward back to First Air Date
    const beforeHistoryBack = mediaRequests.length;
    await page.goBack();
    await expect(page).toHaveURL(/\/tv\/airing-today$/);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeHistoryBack);
    expect(mediaRequests[mediaRequests.length - 1].get("air_date.gte")).toBeTruthy();
    expect(mediaRequests[mediaRequests.length - 1].get("first_air_date.gte") ?? "").toBe("");

    const beforeHistoryForward = mediaRequests.length;
    await page.goForward();
    await expect(page).toHaveURL(/dateMode=first_air_date/);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeHistoryForward);
    expect(mediaRequests[mediaRequests.length - 1].get("first_air_date.gte")).toBeTruthy();
    expect(mediaRequests[mediaRequests.length - 1].get("air_date.gte") ?? "").toBe("");

    // 2. /tv/on-tv: switch to First Air Date AND clear both bounds -> persists across reload
    await page.goto("/tv/on-tv");
    await expect(page.locator("article h2", { hasText: "Game of Thrones" })).toBeVisible();
    await openFiltersIfCollapsed(page);
    await page.getByRole("button", { name: "First Air Date", exact: true }).click();
    await clearDateBound(page, 0);
    await clearDateBound(page, 1);
    await expect(page.getByText("Pick a start date")).toBeVisible();
    await expect(page.getByText("Pick an end date")).toBeVisible();

    const beforeOnTvApply = mediaRequests.length;
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/\/tv\/on-tv\?.*dateMode=first_air_date/);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeOnTvApply);
    const onTvAppliedParams = mediaRequests[mediaRequests.length - 1];
    expect(onTvAppliedParams.get("air_date.gte") ?? "").toBe("");
    expect(onTvAppliedParams.get("air_date.lte") ?? "").toBe("");
    expect(onTvAppliedParams.get("first_air_date.gte") ?? "").toBe("");
    expect(onTvAppliedParams.get("first_air_date.lte") ?? "").toBe("");

    const beforeOnTvReload = mediaRequests.length;
    await page.reload();
    await expect(page.locator("article h2", { hasText: "Game of Thrones" })).toBeVisible();
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeOnTvReload);
    const onTvReloadedParams = mediaRequests[mediaRequests.length - 1];
    expect(onTvReloadedParams.get("air_date.gte") ?? "").toBe("");
    expect(onTvReloadedParams.get("first_air_date.gte") ?? "").toBe("");

    await openFiltersIfCollapsed(page);
    await expect(page.getByText("Pick a start date")).toBeVisible();
    await expect(page.getByText("Pick an end date")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeVisible();
  });

  test("Movie rolling presets (/movie/now-playing & /movie/upcoming) persist explicitly cleared date bounds across reload and Reset/Back", async ({ page }) => {
    await installFilterControlMocks(page);

    const mediaRequests: URLSearchParams[] = [];
    await page.route("**/api/media?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/media") {
        await route.continue();
        return;
      }
      mediaRequests.push(url.searchParams);
      await route.fulfill({ json: SINGLE_PAGE_MOVIES });
    });

    // /movie/now-playing: clear start date only
    await page.goto("/movie/now-playing");
    await expect(page.locator("article h2", { hasText: "Inception" })).toBeVisible();
    const initialNowPlaying = mediaRequests[mediaRequests.length - 1];
    expect(initialNowPlaying.get("release_date.gte")).toBeTruthy();
    expect(initialNowPlaying.get("release_date.lte")).toBeTruthy();

    await openFiltersIfCollapsed(page);
    await clearDateBound(page, 0);
    await expect(page.getByText("Pick a start date")).toBeVisible();

    const beforeApplyCount = mediaRequests.length;
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/release_date_gte=(?:&|$)/);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeApplyCount);
    const clearedStartParams = mediaRequests[mediaRequests.length - 1];
    expect(clearedStartParams.get("release_date.gte") ?? "").toBe("");
    expect(clearedStartParams.get("release_date.lte")).toBeTruthy();

    // Reload retains cleared start bound
    const beforeReloadCount = mediaRequests.length;
    await page.reload();
    await expect(page.locator("article h2", { hasText: "Inception" })).toBeVisible();
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeReloadCount);
    expect(mediaRequests[mediaRequests.length - 1].get("release_date.gte") ?? "").toBe("");
    expect(mediaRequests[mediaRequests.length - 1].get("release_date.lte")).toBeTruthy();

    await openFiltersIfCollapsed(page);
    await expect(page.getByText("Pick a start date")).toBeVisible();

    // Reset restores both preset bounds, and Back returns to cleared state
    const beforeResetCount = mediaRequests.length;
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page).toHaveURL(/\/movie\/now-playing$/);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeResetCount);
    expect(mediaRequests[mediaRequests.length - 1].get("release_date.gte")).toBeTruthy();

    const beforeBackCount = mediaRequests.length;
    await page.goBack();
    await expect(page).toHaveURL(/release_date_gte=(?:&|$)/);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeBackCount);
    expect(mediaRequests[mediaRequests.length - 1].get("release_date.gte") ?? "").toBe("");

    // /movie/upcoming: clear end date only -> persists across reload
    await page.goto("/movie/upcoming");
    await expect(page.locator("article h2", { hasText: "Inception" })).toBeVisible();
    await openFiltersIfCollapsed(page);
    await clearDateBound(page, 1);
    await expect(page.getByText("Pick an end date")).toBeVisible();

    const beforeUpcomingApply = mediaRequests.length;
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/release_date_lte=(?:&|$)/);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeUpcomingApply);
    expect(mediaRequests[mediaRequests.length - 1].get("release_date.gte")).toBeTruthy();
    expect(mediaRequests[mediaRequests.length - 1].get("release_date.lte") ?? "").toBe("");

    const beforeUpcomingReload = mediaRequests.length;
    await page.reload();
    await expect(page.locator("article h2", { hasText: "Inception" })).toBeVisible();
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(beforeUpcomingReload);
    expect(mediaRequests[mediaRequests.length - 1].get("release_date.gte")).toBeTruthy();
    expect(mediaRequests[mediaRequests.length - 1].get("release_date.lte") ?? "").toBe("");
  });

  test("SearchWrapper renders ready category tabs immediately without blocking on slow categories", async ({ page }) => {
    let releaseSlowCategories!: () => void;
    const slowCategoriesGate = new Promise<void>((resolve) => {
      releaseSlowCategories = resolve;
    });

    await page.route("**/api/search/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/search/movie") {
        await route.fulfill({ json: ACTION_FILTERED_MOVIES });
        return;
      }
      if (path === "/api/search/tv") {
        await route.fulfill({ json: { page: 1, total_pages: 1, total_results: 0, results: [] } });
        return;
      }
      await slowCategoriesGate;
      if (path === "/api/search/person") {
        await route.fulfill({
          json: {
            page: 1,
            total_pages: 1,
            total_results: 1,
            results: [{ id: 550, name: "Leonardo DiCaprio", profile_path: null, known_for_department: "Acting" }],
          },
        });
        return;
      }
      await route.fulfill({ json: { page: 1, total_pages: 1, total_results: 0, results: [] } });
    });

    await page.goto("/search?q=Inception");

    // Ready movie tab renders while person & keyword are still loading
    await expect(page.getByRole("tab", { name: "Movies (1)" })).toBeVisible();
    await expect(page.locator("article h2", { hasText: "Inception" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "People (Loading...)" })).toBeVisible();

    await page.getByRole("tab", { name: "People (Loading...)" }).click();
    await expect(
      page.getByRole("status", { name: "Loading people search results" })
    ).toBeVisible();

    releaseSlowCategories();
    await expect(page.getByRole("tab", { name: "People (1)" })).toBeVisible();
    await expect(page.getByText("Leonardo DiCaprio")).toBeVisible();
  });
});
