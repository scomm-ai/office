import { defineConfig, devices } from "@playwright/test";

/**
 * Optional browser smoke tests for the task pane (mock host mode).
 * Requires `pnpm --filter @scomm-office/outlook-addin dev` or preview.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.ADDIN_BASE_URL ?? "https://localhost:5173",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
