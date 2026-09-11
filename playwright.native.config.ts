import { defineConfig, devices } from "@playwright/test";

/**
 * Native landscape gate (P2): real WebKit engine with iPhone touch
 * emulation at representative landscape sizes. Runs only
 * tests/mobile-native.spec.ts; the desktop chromium gate keeps running the
 * framed preview suite via playwright.config.ts.
 */
const testPort = Number(process.env.MOBILE_RUNTIME_TEST_PORT ?? 4174);

export default defineConfig({
  testDir: "./tests",
  testMatch: "mobile-native.spec.ts",
  timeout: 30_000,
  workers: 2,
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
  },
  projects: [
    {
      name: "webkit-iphone-landscape-13",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
        viewport: { width: 844, height: 390 },
      },
    },
    {
      name: "webkit-iphone-landscape-15-pro",
      use: {
        ...devices["iPhone 15 Pro"],
        browserName: "webkit",
        viewport: { width: 852, height: 393 },
      },
    },
  ],
});
