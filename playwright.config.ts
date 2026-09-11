import { defineConfig } from "@playwright/test";

const testPort = Number(process.env.MOBILE_RUNTIME_TEST_PORT ?? 4174);

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  // Keep local feedback parallel, but serialize the cloud browser gate. The
  // shared Vite simulation clock has several deliberately transient states;
  // runner CPU contention must not make cross-page sampling nondeterministic.
  workers: process.env.CI ? 1 : 2,
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    viewport: { width: 1100, height: 1100 },
  },
});
