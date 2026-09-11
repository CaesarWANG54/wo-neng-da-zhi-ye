import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.CAREER_QA_URL ?? "http://127.0.0.1:4175";
const outputDirectory = resolve(process.cwd(), "qa-artifacts", "m6-calendar");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });

await page.goto(`${baseUrl}/?qa=career-home`);
await page.getByTestId("career-home-screen").waitFor();
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "iphone-calendar-october.png") });

await page.getByTestId("calendar-next-month").click();
await page.getByTestId("calendar-next-month").click();
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "iphone-calendar-cup-tbd.png") });

await page.goto(`${baseUrl}/?qa=draft-ceremony`);
await page.getByTestId("draft-ceremony-screen").waitFor();
await page.getByTestId("draft-next").click();
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "iphone-draft-second-pick.png") });

await page.goto(`${baseUrl}/?qa=career-home`);
await page.getByTestId("device-picker").click();
await page.getByTestId("device-option-pixel-10").click();
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "pixel-calendar-october.png") });

await browser.close();
console.log(outputDirectory);
