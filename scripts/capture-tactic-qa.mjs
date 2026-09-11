import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.TACTIC_QA_URL ?? "http://127.0.0.1:4174";
const outputDirectory = resolve(process.cwd(), "qa-artifacts", "tactic-experience");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 1120 }, deviceScaleFactor: 1 });
await page.goto(`${baseURL}/?qa=game`);
await page.getByTestId("game-screen").waitFor({ state: "visible" });
await page.getByTestId("action-tactic").click();
await page.getByRole("menuitem", { name: /牛角落位/ }).click();
await page.waitForTimeout(650);
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "iphone-live-tactic.png") });

await page.getByTestId("device-picker").click();
await page.getByTestId("device-option-pixel-10").click();
await page.waitForTimeout(250);
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "pixel-live-tactic.png") });

await page.goto(`${baseURL}/?qa=create`);
await page.getByTestId("position-sg").click();
await page.getByTestId("template-sg_engine").click();
await page.waitForTimeout(150);
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "pixel-sg-template.png") });

await page.goto(`${baseURL}/?qa=defense`);
await page.getByTestId("game-screen").waitFor({ state: "visible" });
await page.waitForTimeout(700);
await page.getByTestId("phone-frame").screenshot({ path: resolve(outputDirectory, "pixel-opponent-tactic.png") });
await browser.close();
