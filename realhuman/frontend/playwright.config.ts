import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * End-to-end tests run against a production build (`next build && next start`)
 * so they exercise the same output that ships. Set E2E_BASE_URL to point at an
 * already running server instead.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: [/mobile\.spec\.ts/, /fallback\.spec\.ts/],
    },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
    {
      name: "no-webgl",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"] },
      },
      testMatch: /fallback\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npx next start -p ${PORT}`,
        url: baseURL,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
      },
});
