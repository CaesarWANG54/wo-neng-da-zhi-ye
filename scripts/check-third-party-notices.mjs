#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const outputPath = resolve(root, "docs", "release", "THIRD_PARTY_NOTICES.md");
const allowedLicenses = new Set(["0BSD", "MIT", "OFL-1.1"]);

const packages = Object.entries(lock.packages ?? {})
  .filter(([path, metadata]) => path.startsWith("node_modules/") && metadata.dev !== true && metadata.devOptional !== true)
  .map(([path, metadata]) => ({
    name: metadata.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length),
    version: metadata.version,
    license: metadata.license,
  }))
  .sort((left, right) => left.name.localeCompare(right.name, "en"));

const invalid = packages.filter(({ name, version, license }) => (
  typeof name !== "string"
  || typeof version !== "string"
  || typeof license !== "string"
  || !allowedLicenses.has(license)
));
if (invalid.length > 0) {
  console.error("Third-party notice check found missing or unreviewed production dependency metadata:");
  for (const item of invalid) console.error(`- ${item.name}@${item.version ?? "?"}: ${item.license ?? "no license"}`);
  process.exit(1);
}

const rows = packages.map(({ name, version, license }) => `| \`${name}\` | \`${version}\` | \`${license}\` |`).join("\n");
const expected = `# Third-party notices

Generated from the locked production dependency graph on 2026-09-07. Run \`npm run update:notices\` only after an intentional, reviewed dependency change; CI uses \`npm run check:notices\` to prevent drift.

This inventory records third-party components used by the publicly visible but proprietary pre-release source candidate. It does not grant a license to the game source, names, data, art, or audio. The project-level LICENSE does not replace any third-party term. Before public distribution, the owner must complete the rights review and include every attribution, copyright notice, and full license text required by the final distribution channel.

| Package | Locked version | SPDX license |
| --- | ---: | --- |
${rows}

## License references

- MIT: <https://spdx.org/licenses/MIT.html>
- SIL Open Font License 1.1: <https://spdx.org/licenses/OFL-1.1.html>
- BSD Zero Clause License: <https://spdx.org/licenses/0BSD.html>
`;

if (process.argv.includes("--write")) {
  await writeFile(outputPath, expected, "utf8");
  console.log(`Updated ${outputPath}.`);
  process.exit(0);
}

let actual;
try {
  actual = await readFile(outputPath, "utf8");
} catch {
  console.error("Third-party notice file is missing; run npm run update:notices after reviewing the production dependency licenses.");
  process.exit(1);
}

if (actual.replaceAll("\r\n", "\n") !== expected) {
  console.error("Third-party notice inventory is stale; review the dependency change, then run npm run update:notices.");
  process.exit(1);
}

console.log(`Third-party notice inventory passed (${packages.length} production packages).`);
