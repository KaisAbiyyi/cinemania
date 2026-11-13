import { test, expect } from "@playwright/test";

test.describe("CineMatch E2E Smoke Tests (100% Offline & Deterministic TMDB Mock)", () => {
  test.beforeEach(async ({ page }) => {
    // Monitor for any upstream image or network failures
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/_next/image") || url.includes("/api/")) {
        expect(
          response.status(),
          `Unexpected failed response (${response.status()}) for URL: ${url}`
        ).toBeLessThan(400);
      }
    });
  });

  test("home page loads and renders core elements without broken images", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Verify title
    await expect(page).toHaveTitle(/Cinemania/);

    // Verify navbar and search bar
    const navbar = page.locator('nav[role="navigation"]');
    await expect(navbar).toBeVisible();
    const searchInput = navbar.locator('input[placeholder*="Search" i], input[type="search"]');
    await expect(searchInput).toBeVisible();
  });

  test("movies page renders seeded movies with loaded images", async ({ page }) => {
    const response = await page.goto("/movie");
    expect(response?.status()).toBe(200);

    // Assert seeded movie titles from fixtures are visible
    const inceptionCard = page.locator('article h2:has-text("Inception")').first();
    await expect(inceptionCard).toBeVisible({ timeout: 10000 });

    const interstellarCard = page.locator('article h2:has-text("Interstellar")').first();
    await expect(interstellarCard).toBeVisible({ timeout: 10000 });

    // Assert poster images are actually loaded and non-broken (naturalWidth > 0)
    const firstPoster = page.locator('article img[alt="Inception"]').first();
    await expect(firstPoster).toBeVisible();
    await expect(async () => {
      const isLoaded = await firstPoster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
      expect(isLoaded).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test("tv series page renders seeded tv shows with loaded images", async ({ page }) => {
    const response = await page.goto("/tv");
    expect(response?.status()).toBe(200);

    // Assert seeded TV titles from fixtures are visible
    const gotCard = page.locator('article h2:has-text("Game of Thrones")').first();
    await expect(gotCard).toBeVisible({ timeout: 10000 });

    const breakingBadCard = page.locator('article h2:has-text("Breaking Bad")').first();
    await expect(breakingBadCard).toBeVisible({ timeout: 10000 });

    // Assert poster images are actually loaded and non-broken
    const gotPoster = page.locator('article img[alt="Game of Thrones"]').first();
    await expect(gotPoster).toBeVisible();
    await expect(async () => {
      const isLoaded = await gotPoster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
      expect(isLoaded).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test("search page displays exact seeded movie results and loaded artwork", async ({ page }) => {
    const response = await page.goto("/search?q=Inception");
    expect(response?.status()).toBe(200);

    // Assert tab count reflects exact seeded match: Movies (1)
    const moviesTab = page.getByRole("tab", { name: /Movies \(1\)/i });
    await expect(moviesTab).toBeVisible({ timeout: 10000 });

    // Assert exact movie title and date rendered in MediaCard
    const movieHeading = page.locator('article h2:has-text("Inception")').first();
    await expect(movieHeading).toBeVisible();
    const releaseDate = page.locator("article time");
    await expect(releaseDate.first()).toContainText("2010");

    // Assert image loaded
    const poster = page.locator('article img[alt="Inception"]').first();
    await expect(poster).toBeVisible();
    await expect(async () => {
      const isLoaded = await poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
      expect(isLoaded).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test("negative search displays zero result counters and zero cards", async ({ page }) => {
    const response = await page.goto("/search?q=nonexistent_random_movie_xyz");
    expect(response?.status()).toBe(200);

    // Assert tabs reflect exactly 0 results across categories
    const moviesTab = page.getByRole("tab", { name: /Movies \(0\)/i });
    await expect(moviesTab).toBeVisible({ timeout: 10000 });

    const tvTab = page.getByRole("tab", { name: /TV \(0\)/i });
    await expect(tvTab).toBeVisible();

    // Assert no movie/tv media cards rendered
    const mediaCards = page.locator("article");
    await expect(mediaCards).toHaveCount(0);
  });
});
