import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:3055",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start -- -p 3055",
    url: "http://127.0.0.1:3055",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      NODE_OPTIONS: "--require ./tests/fixtures/mock-tmdb.cjs",
      TMDB_API_RAT: "mock-tmdb-offline-rat-token",
      NEXT_PUBLIC_TMDB_POSTER_URL: "https://image.tmdb.org/t/p/w500",
      NEXT_PUBLIC_IMAGE_BASE_URL: "https://image.tmdb.org/t/p",
      PORT: "3055",
    },
  },
});
