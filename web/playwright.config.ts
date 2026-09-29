import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite: the production build of the web app against the REAL AgentOS API + worker
 * with a scripted model and a simulated Google Workspace (backend/scripts/e2e_backend.py).
 * The backend uses its own database (`agentos_e2e`, recreated on every start) and Redis db.
 *
 *   npm run build && npm run test:e2e
 *
 * Env: E2E_BASE_URL (skip starting servers, test an existing deployment of the web app),
 * E2E_WEB_PORT (3100), E2E_API_PORT (8100), E2E_PYTHON (backend interpreter).
 */
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.E2E_API_PORT ?? 8100);
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://127.0.0.1:${webPort}`;
const python = process.env.E2E_PYTHON ?? "../backend/.venv/bin/python";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /(auth|responsive)\.spec\.ts/,
    },
  ],
  webServer: external
    ? undefined
    : [
        {
          name: "api",
          command: `${python} ../backend/scripts/e2e_backend.py`,
          url: `http://127.0.0.1:${apiPort}/api/v1/live`,
          env: { E2E_API_PORT: String(apiPort), E2E_WEB_URL: baseURL },
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "ignore",
          stderr: "pipe",
        },
        {
          name: "web",
          // Requires `npm run build` first (CI builds once and reuses the output).
          command: `npx next start -p ${webPort} -H 127.0.0.1`,
          url: `${baseURL}/healthz`,
          env: { AGENTOS_API_ORIGIN: `http://127.0.0.1:${apiPort}` },
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      ],
});
