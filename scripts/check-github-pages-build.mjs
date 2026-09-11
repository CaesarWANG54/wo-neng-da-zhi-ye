#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDirectory = path.join(root, "dist", "client");
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").at(-1) || "wo-neng-da-zhi-ye";
const expectedBase = `/${repositoryName}/`;
const failures = [];

if (!existsSync(path.join(clientDirectory, "index.html"))) {
  failures.push("dist/client/index.html is missing");
} else {
  const index = readFileSync(path.join(clientDirectory, "index.html"), "utf8");
  if (!index.includes(`${expectedBase}assets/`)) {
    failures.push(`index.html does not use the expected ${expectedBase} asset base`);
  }
  if (/["'`]\/assets\//u.test(index)) {
    failures.push("index.html contains a root-only /assets/ URL");
  }
}

const assetDirectory = path.join(clientDirectory, "assets");
if (!existsSync(assetDirectory)) {
  failures.push("dist/client/assets is missing");
} else {
  for (const entry of readdirSync(assetDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name) !== ".js") continue;
    const content = readFileSync(path.join(assetDirectory, entry.name), "utf8");
    if (/["'`]\/assets\//u.test(content)) {
      failures.push(`dist/client/assets/${entry.name} contains a root-only /assets/ URL`);
    }
  }
}

for (const requiredFile of [
  "assets/game/paper-court.webp",
  "assets/audio/court-dribble.mp3",
  "assets/audio/basket-swish.mp3",
  "assets/iphone/Bezel.png",
  "assets/android/Pixel10.png",
]) {
  if (!existsSync(path.join(clientDirectory, requiredFile))) {
    failures.push(`dist/client/${requiredFile} is missing`);
  }
}

if (failures.length > 0) {
  console.error("GitHub Pages build check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`GitHub Pages build check passed for ${expectedBase}.`);
