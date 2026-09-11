import { defineConfig } from "@playwright/test";

const testPort = Number(process.env.GITHUB_PAGES_TEST_PORT ?? 4175);

export default defineConfig({
  testDir: "./tests",
  testMatch: "github-pages-preview.spec.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  workers: 1,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${testPort}/wo-neng-da-zhi-ye/`,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
});
