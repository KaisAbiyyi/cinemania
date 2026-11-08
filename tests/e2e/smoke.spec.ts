import { test, expect } from "@playwright/test";

test.describe("CineMatch E2E Smoke Tests (Offline & Deterministic TMDB Mock)", () => {
  test("home page loads and renders core elements", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Verify title
    await expect(page).toHaveTitle(/Cinemania/);

    // Verify navbar is present
    const navbar = page.locator('nav[role="navigation"]');
    await expect(navbar).toBeVisible();

    // Verify search input is present
    const searchInput = page.locator('input[placeholder*="Search" i], input[type="search"]');
    await expect(searchInput).toBeVisible();
  });

  test("movies page renders movies list from deterministic fixtures", async ({ page }) => {
    const response = await page.goto("/movie");
    expect(response?.status()).toBe(200);

    // Verify heading or page content is loaded
    await expect(page.locator("body")).not.toBeEmpty();

    // Verify at least one movie card/link exists
    const movieCards = page.locator('a[href*="/movie/"]');
    await expect(movieCards.first()).toBeVisible({ timeout: 10000 });
  });

  test("tv series page renders tv list from deterministic fixtures", async ({ page }) => {
    const response = await page.goto("/tv");
    expect(response?.status()).toBe(200);

    // Verify body loaded
    await expect(page.locator("body")).not.toBeEmpty();

    // Verify tv cards are rendered
    const tvCards = page.locator('a[href*="/tv/"]');
    await expect(tvCards.first()).toBeVisible({ timeout: 10000 });
  });

  test("search page displays results for matching queries", async ({ page }) => {
    const response = await page.goto("/search?q=Inception");
    expect(response?.status()).toBe(200);

    // Verify Inception is present in the document
    await expect(page.getByText("Inception").first()).toBeVisible({ timeout: 10000 });
  });

  test("search page handles empty/negative search results cleanly", async ({ page }) => {
    const response = await page.goto("/search?q=nonexistent_random_movie_xyz");
    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
