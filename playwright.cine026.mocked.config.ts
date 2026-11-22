import { defineConfig, devices } from "@playwright/test";

/** Local SQLite + offline TMDB vote/final-state regressions; never Supabase Realtime validation. */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["room-voting.spec.ts", "room-finish-states.spec.ts", "cine026a-join-hydration.spec.ts", "cine026a-redaction-init.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-cine026-mocked" }]],
  use: {
    baseURL: "http://127.0.0.1:3055",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run start -- -p 3055",
    url: "http://127.0.0.1:3055",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      NODE_OPTIONS: "--require ./tests/fixtures/mock-tmdb.cjs",
      TMDB_API_RAT: "mock-tmdb-offline-cine026",
      CINEMATCH_CAPABILITY_SECRET: "e2e-offline-test-capability-secret-32-bytes",
      CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD: "true",
      NEXT_PUBLIC_TMDB_POSTER_URL: "https://image.tmdb.org/t/p",
      NEXT_PUBLIC_IMAGE_BASE_URL: "https://image.tmdb.org/t/p",
      PORT: "3055",
    },
  },
});
