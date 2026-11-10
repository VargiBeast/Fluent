import { defineConfig, devices } from "@playwright/test";

const chrome = process.env.PLAYWRIGHT_CHROME ?? (process.env.CI ? undefined : "/usr/bin/google-chrome");

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${process.env.E2E_PORT ?? 4173}`,
    trace: "retain-on-failure",
    launchOptions: chrome ? { executablePath: chrome } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    command: "pnpm build && tsx tests/e2e/serve.ts",
    url: `http://localhost:${process.env.E2E_PORT ?? 4173}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
