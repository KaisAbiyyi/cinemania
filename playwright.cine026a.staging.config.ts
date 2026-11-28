import { defineConfig, devices } from "@playwright/test";

// CINE-026-A diagnostic config: same staging project guard as the CINE-026 config, but only the
// convergence/reconnect diagnostics. Never runs without the exact-project invocation consent.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadHostedStaging } = require("./tests/hosted-supabase/environment.cjs") as { loadHostedStaging: () => { project: string } };
loadHostedStaging();

const browsers = { chromium: { ...devices["Desktop Chrome"] }, firefox: { ...devices["Desktop Firefox"] }, webkit: { ...devices["Desktop Safari"] } };
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "cine026a-staging-*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3065", trace: "off", screenshot: "off", video: "off" },
  projects: (Object.entries(browsers) as Array<[keyof typeof browsers, (typeof browsers)[keyof typeof browsers]]>).map(([name, use]) => ({ name, use })),
  webServer: { command: "npm run start -- -p 3065", url: "http://127.0.0.1:3065", reuseExistingServer: false, timeout: 120000 },
});
