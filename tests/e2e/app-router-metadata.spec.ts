import { test, expect } from "@playwright/test";

type RouteExpectation = {
  path: string;
  canonical: string;
  titlePattern: RegExp;
  expectedHeading?: string;
};

async function verifyRoutesMetadataAndHydration(
  page: import("@playwright/test").Page,
  routesToCheck: RouteExpectation[],
  options: { hydrationOnly?: boolean } = {}
) {
  const runtimeErrors: string[] = [];
  const hydrationErrors: string[] = [];
  const hydrationPattern = /hydrat|did not match|server html|Minified React error #(?:418|423|425)/i;
  page.on("pageerror", (err) => {
    runtimeErrors.push(`pageerror: ${err.message}`);
    if (hydrationPattern.test(err.message)) {
      hydrationErrors.push(`pageerror: ${err.message}`);
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      runtimeErrors.push(`console.error: ${text}`);
      if (hydrationPattern.test(text)) {
        hydrationErrors.push(`console.error: ${text}`);
      }
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      runtimeErrors.push(`http_${res.status()}: ${res.url()}`);
    }
  });

  for (const route of routesToCheck) {
    await test.step(`Verify SSR + client metadata for ${route.path}`, async () => {
      // 1. Inspect raw SSR HTTP HTML directly before client JavaScript runs
      const rawResponse = await page.request.get(route.path);
      expect(rawResponse.status(), `SSR HTTP status for ${route.path}`).toBe(200);
      const rawHtml = await rawResponse.text();
      const decodedHtml = rawHtml.replace(/&amp;/g, "&");

      expect(rawHtml).not.toMatch(/cinemania\.com|yourdomain\.com|og-image\.jpg|\/og\/[a-z0-9-]+\.jpg|default-image-path/i);
      expect(rawHtml).toContain("<title>");
      expect(rawHtml).toContain('name="description"');
      expect(rawHtml).toContain(`rel="canonical" href="${route.canonical}"`);
      expect(rawHtml).toContain('property="og:title"');
      if (route.expectedHeading) {
        expect(decodedHtml, `SSR heading present in raw HTML for ${route.path}`).toContain(route.expectedHeading);
      }

      // 2. Navigate and compare server-rendered metadata with client-hydrated DOM
      const navResponse = await page.goto(route.path);
      expect(navResponse?.status()).toBe(200);
      await expect(page).toHaveTitle(route.titlePattern);

      const clientCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(clientCanonical).toBe(route.canonical);

      const clientDescription = await page.locator('meta[name="description"]').getAttribute("content");
      expect(clientDescription).toBeTruthy();

      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
      expect(ogTitle).toContain("Cinemania");

      if (route.expectedHeading) {
        await expect(page.locator("h1").filter({ hasText: route.expectedHeading }).first()).toBeVisible();
      }
    });
  }

  if (options.hydrationOnly) {
    expect(hydrationErrors, "Zero React hydration mismatches across dynamic detail routes").toEqual([]);
  } else {
    expect(runtimeErrors, "Zero console errors, HTTP >=400, or hydration warnings across routes").toEqual([]);
  }
}

test.describe("CINE-009: App Router Rendering, Metadata & Hydration", () => {
  test("static and discovery routes serve crawlable SSR HTML metadata with canonicals and zero hydration mismatches", async ({
    page,
  }) => {
    await verifyRoutesMetadataAndHydration(page, [
      {
        path: "/",
        canonical: "/",
        titlePattern: /^Cinemania - Explore Movies & TV Shows$/,
        expectedHeading: "Popular Movies",
      },
      {
        path: "/trending",
        canonical: "/trending",
        titlePattern: /^Trending Movies & TV Shows \| Cinemania$/,
        expectedHeading: "Trending Movies & TV Shows",
      },
      {
        path: "/movie",
        canonical: "/movie",
        titlePattern: /^Movies \| Cinemania$/,
        expectedHeading: "Movies",
      },
      {
        path: "/movie/now-playing",
        canonical: "/movie/now-playing",
        titlePattern: /^Now Playing Movies \| Cinemania$/,
        expectedHeading: "Now Playing Movies",
      },
      {
        path: "/movie/upcoming",
        canonical: "/movie/upcoming",
        titlePattern: /^Upcoming Movies \| Cinemania$/,
        expectedHeading: "Upcoming Movies",
      },
      {
        path: "/movie/top-rated",
        canonical: "/movie/top-rated",
        titlePattern: /^Top Rated Movies \| Cinemania$/,
        expectedHeading: "Top Rated Movies",
      },
      {
        path: "/tv",
        canonical: "/tv",
        titlePattern: /^TV Shows \| Cinemania$/,
        expectedHeading: "TV Shows",
      },
      {
        path: "/tv/airing-today",
        canonical: "/tv/airing-today",
        titlePattern: /^Airing Today TV Shows \| Cinemania$/,
        expectedHeading: "Airing Today TV Shows",
      },
      {
        path: "/tv/on-tv",
        canonical: "/tv/on-tv",
        titlePattern: /^On The Air TV Shows \| Cinemania$/,
        expectedHeading: "On The Air TV Shows",
      },
      {
        path: "/tv/top-rated",
        canonical: "/tv/top-rated",
        titlePattern: /^Top Rated TV Shows \| Cinemania$/,
        expectedHeading: "Top Rated TV Shows",
      },
      {
        path: "/genre/28-action/movie",
        canonical: "/genre/28-action/movie",
        titlePattern: /^Action Movies \| Cinemania$/,
        expectedHeading: "Action Movies",
      },
      {
        path: "/keyword/4565-dystopia/movie",
        canonical: "/keyword/4565-dystopia/movie",
        titlePattern: /^Dystopia Movies \| Cinemania$/,
        expectedHeading: "Dystopia Movies",
      },
    ]);
  });

  test("dynamic detail routes limited metadata & hydration probe (client TMDB detail fetches uncertified under minimal fixtures)", async ({
    page,
  }) => {
    // Scope boundary: tests/fixtures/mock-tmdb.cjs intentionally seeds discovery/search/movie
    // core endpoints rather than full /tv/*/reviews, /person/*, or ::ffff:127.0.0.1 geolocation.
    // This test verifies SSR metadata, canonicals, and zero React hydration mismatches only, and
    // must NOT be interpreted as end-to-end healthy client detail fetching.
    await verifyRoutesMetadataAndHydration(
      page,
      [
        {
          path: "/movie/27205-inception",
          canonical: "/movie/27205-inception",
          titlePattern: /^Inception \| Cinemania$/,
        },
        {
          path: "/tv/1399-game-of-thrones/reviews",
          canonical: "/tv/1399-game-of-thrones/reviews",
          titlePattern: /^Reviews of Game Of Thrones \| Cinemania$/,
        },
        {
          path: "/person/6193-leonardo-dicaprio",
          canonical: "/person/6193-leonardo-dicaprio",
          titlePattern: /^Leonardo Dicaprio \| Cinemania$/,
        },
      ],
      { hydrationOnly: true }
    );
  });

  test("dynamic search route renders SSR query heading and noindex metadata cleanly", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    const rawResponse = await page.request.get("/search?q=Inception");
    expect(rawResponse.status()).toBe(200);
    const rawHtml = await rawResponse.text();

    expect(rawHtml).toContain("<title>Inception | Cinemania</title>");
    expect(rawHtml).toContain("Search Results for: <!-- -->Inception");
    expect(rawHtml).toMatch(/<meta name="robots" content="noindex,\s*follow"/i);
    expect(rawHtml).not.toMatch(/cinemania\.com|og-image\.jpg/i);

    await page.goto("/search?q=Inception");
    await expect(page).toHaveTitle("Inception | Cinemania");
    await expect(page.locator("h1")).toContainText("Search Results for: Inception");
    await expect(page.getByRole("tab", { name: /Movies \(1\)/i })).toBeVisible({ timeout: 10000 });
    expect(errors).toEqual([]);
  });

  test("returns HTTP 404 with NotFound UI and loaded 404 illustration, and exposes clean robots.txt", async ({
    page,
  }) => {
    const robotsResp = await page.request.get("/robots.txt");
    expect(robotsResp.status()).toBe(200);
    const robotsText = await robotsResp.text();
    expect(robotsText).toContain("Allow: /");
    expect(robotsText).toContain("Disallow: /api/");
    expect(robotsText).toContain("Disallow: /search");
    expect(robotsText).not.toMatch(/cinemania\.com|yourdomain\.com/i);

    const notFoundResp = await page.goto("/this-route-does-not-exist-cine-009");
    expect(notFoundResp?.status()).toBe(404);
    await expect(page.getByText("Oops...")).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to Home/i })).toHaveAttribute("href", "/");

    const notFoundSvg = page.locator('img[alt="Page Not Found"]');
    await expect(notFoundSvg).toBeVisible();
    await expect
      .poll(() => notFoundSvg.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
  });

  test("footer links resolve cleanly without broken /about link and interactive filters stay client-side", async ({
    page,
  }) => {
    await page.goto("/movie");

    const footerNavHrefs = await page
      .locator('footer nav[aria-label="Site Navigation"] a')
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));

    expect(footerNavHrefs).toEqual(["/", "/trending", "/movie", "/tv"]);
    expect(footerNavHrefs).not.toContain("/about");

    for (const href of footerNavHrefs) {
      const resp = await page.request.get(href!);
      expect(resp.status(), `Footer nav target ${href} must exist`).toBe(200);
    }

    // Open client-side filter panel and verify local sort selection fires client API fetch without SSR reload
    await page.evaluate(() => {
      (window as unknown as { __cineStayClient?: string }).__cineStayClient = "alive";
    });
    const filterResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/media") && res.url().includes("sort_by=vote_average.desc")
    );
    await page.getByRole("button", { name: /^Filter$/i }).click();
    await expect(page.getByText("Sort Results By")).toBeVisible();
    await page.locator("#sort-by-select").click();
    await page.getByRole("option", { name: "Vote Average Descending" }).click();
    await expect(page.locator("#sort-by-select")).toContainText("Vote Average Descending");
    await page.getByRole("button", { name: /^Apply$/i }).click();
    const filterResponse = await filterResponsePromise;
    expect(filterResponse.status()).toBeLessThan(400);
    const markerAfter = await page.evaluate(
      () => (window as unknown as { __cineStayClient?: string }).__cineStayClient ?? null
    );
    expect(markerAfter).toBe("alive");

    // Verify viewer-local calendar date preset fires from /tv/airing-today on client navigation
    const airingRequestPromise = page.waitForRequest((req) => {
      const url = new URL(req.url());
      return url.pathname === "/api/media" && url.searchParams.get("mediaType") === "tv";
    });
    await page.goto("/tv/airing-today");
    const airingReq = await airingRequestPromise;
    const browserLocalToday = await page.evaluate(() => {
      const now = new Date();
      const y = String(now.getFullYear()).padStart(4, "0");
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    });
    const airingUrl = new URL(airingReq.url());
    expect(airingUrl.searchParams.get("air_date.gte")).toBe(browserLocalToday);
    expect(airingUrl.searchParams.get("air_date.lte")).toBe(browserLocalToday);
  });
});
