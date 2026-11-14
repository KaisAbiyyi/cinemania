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
    await expect(page.getByRole("status")).toContainText("No results found");
    await expect(page.locator("article")).toHaveCount(0);

    await page.goto("/trending");
    await expect(page.getByRole("status")).toContainText("No trending results");

    await page.goto("/genre/28-action/movie");
    await expect(page.getByRole("status")).toContainText("No movies were found for this genre");

    await page.goto("/keyword/123-dream/movie");
    await expect(page.getByRole("status")).toContainText("No movies were found for this keyword");

    // Empty /search route with no query should show accessible empty state, not error
    await page.goto("/search");
    await expect(page.getByRole("status")).toContainText("Search Cinemania");

    // /search with 0 results
    await page.goto("/search?q=nonexistenttitle999");
    await expect(page.getByRole("tab", { name: /Movies \(0\)/i })).toBeVisible();
    await expect(page.getByRole("status")).toContainText('No movies matched "nonexistenttitle999"');

    // Detail subview /cast empty
    await page.goto("/movie/27205-inception/cast");
    await expect(page.getByRole("status")).toContainText("No cast or crew");
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
});
