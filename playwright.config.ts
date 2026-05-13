import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — gates the browser E2E spec at
 * tests/e2e/slice-01-walking-skeleton.spec.ts. Per DELIVER step 0 this
 * runs only after `apps/web` and `apps/api` are implemented (step 1+).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL: process.env.NETEA_E2E_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
