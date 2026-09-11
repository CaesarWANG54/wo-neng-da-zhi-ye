import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.REBOUND_QA_URL ?? "http://127.0.0.1:4174";
const outputDirectory = resolve(process.cwd(), "qa-artifacts", "rebound-flow");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 1120 }, deviceScaleFactor: 1 });
await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });

await page.goto(`${baseURL}/?qa=shot`);
await page.getByTestId("game-screen").waitFor({ state: "visible" });
await page.clock.runFor(350);
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "iphone-shot-flight.png") });

await page.goto(`${baseURL}/?qa=rebound`);
await page.getByTestId("game-screen").waitFor({ state: "visible" });
await page.clock.runFor(250);
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "iphone-rebound-contest.png") });

await page.getByTestId("device-picker").click();
await page.getByTestId("device-option-pixel-10").click();
await page.clock.runFor(1_600);
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "pixel-rebound-resolved.png") });

await browser.close();
