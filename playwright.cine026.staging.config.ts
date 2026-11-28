import { defineConfig, devices } from "@playwright/test";

// This config is deliberately separate from the secret-free CI/offline config.
// Loading it validates the exact staging project and invocation consent first.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadHostedStaging } = require("./tests/hosted-supabase/environment.cjs") as {
  loadHostedStaging: () => { project: string };
};
loadHostedStaging();

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "cine026-staging.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-cine026-staging" }]],
  use: {
    baseURL: "http://127.0.0.1:3065",
    screenshot: "only-on-failure",
    // The hosted browser session contains signed membership cookies and Realtime tokens.
    // Video is retained only for failing tests; raw Playwright traces are disabled.
    trace: "off",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run start -- -p 3065",
    url: "http://127.0.0.1:3065",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
