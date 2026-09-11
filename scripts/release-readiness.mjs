#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findSecretMatches, isScannableTextFile, validateRepositoryProtection } from "./release-readiness-rules.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strictPublic = process.argv.includes("--strict-public");
const failures = [];
const warnings = [];

const requiredFiles = [
  ".github/workflows/ci.yml",
  ".github/workflows/public-release.yml",
  ".github/dependabot.yml",
  ".github/CODEOWNERS",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/pull_request_template.md",
  ".gitattributes",
  ".gitignore",
  ".node-version",
  "AGENTS.md",
  "ASSET_LICENSE.md",
  "CONTRIBUTING.md",
  "CONTRIBUTOR_POLICY.md",
  "COPYRIGHT.md",
  "FAN_EDITION_NOTICE.md",
  "CHANGELOG.md",
  "LICENSE",
  "NOTICE.md",
  "PRIVACY.md",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "TRADEMARKS.md",
  "docs/release/GITHUB_RELEASE_CHECKLIST.md",
  "docs/release/PUBLIC_REPOSITORY_PROTECTION.md",
  "docs/release/RELEASE_BLOCKERS.md",
  "docs/release/THIRD_PARTY_NOTICES.md",
  "docs/rights/rights-ledger.md",
  "mobile-runtime.lock.json",
  "package-lock.json",
  "public/assets/audio/audio-manifest.json",
  "public/assets/game/game-asset-manifest.json",
];

const ignoredTrees = new Set([
  ".git",
  ".npm",
  ".pnpm-store",
  "node_modules",
  "playwright-report",
  "qa-artifacts",
  "test-results",
]);

const toPosix = (value) => value.split(sep).join("/");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredTrees.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolutePath)));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

for (const requiredFile of requiredFiles) {
  if (!existsSync(join(root, requiredFile))) failures.push(`missing required file: ${requiredFile}`);
}

const gitignorePath = join(root, ".gitignore");
if (existsSync(gitignorePath)) {
  const gitignore = await readFile(gitignorePath, "utf8");
  for (const entry of ["node_modules/", "dist/", "qa-artifacts/", "*.log", ".env"]) {
    if (!gitignore.includes(entry)) failures.push(`.gitignore is missing: ${entry}`);
  }
}

const workflowPath = join(root, ".github", "workflows", "ci.yml");
if (existsSync(workflowPath)) {
  const workflow = await readFile(workflowPath, "utf8");
  const requiredWorkflowFragments = [
    "permissions:\n  contents: read",
    "ubuntu-latest",
    "windows-latest",
    "node-version-file: .node-version",
    "npm ci",
    "npm run check:runtime",
    "npm run test:core",
    "npm run test:runtime",
    "npm run test:native",
    "npm run build",
    "npm run test:sites",
    "npm run check:notices",
    "npm run test:release",
  ];
  for (const fragment of requiredWorkflowFragments) {
    if (!workflow.includes(fragment)) failures.push(`CI workflow is missing required fragment: ${fragment}`);
  }
}

for (const localResidue of ["debug.log", "dist", "qa-artifacts", "test-results", "playwright-report"]) {
  if (existsSync(join(root, localResidue))) {
    warnings.push(`local generated residue exists but is ignored: ${localResidue}`);
  }
}

if (!existsSync(join(root, ".git"))) {
  warnings.push("this directory is not yet an independent Git repository; initialize it only after owner review");
}

const files = await walk(root);
for (const absolutePath of files) {
  const relativePath = toPosix(relative(root, absolutePath));
  const fileInfo = await stat(absolutePath);
  const baseName = relativePath.split("/").at(-1) ?? relativePath;

  if (/^\.env(?:\.|$)/u.test(baseName) && !/\.example$/u.test(baseName)) {
    failures.push(`environment file must not be committed: ${relativePath}`);
  }
  if (/\.(?:jks|key|p12|pem|pfx)$/iu.test(baseName)) {
    failures.push(`credential or certificate file requires explicit review: ${relativePath}`);
  }

  if (!relativePath.startsWith("dist/") && fileInfo.size > 10 * 1024 * 1024) {
    failures.push(`source file exceeds the 10 MiB project review limit: ${relativePath}`);
  } else if (!relativePath.startsWith("dist/") && fileInfo.size > 5 * 1024 * 1024) {
    warnings.push(`source file exceeds 5 MiB and should be reviewed: ${relativePath}`);
  }

  if (!isScannableTextFile(baseName)) continue;
  const contents = await readFile(absolutePath, "utf8");
  for (const label of findSecretMatches(contents)) failures.push(`${label} pattern found in ${relativePath}`);
}

const rightsPath = join(root, "docs", "rights", "rights-ledger.md");
if (existsSync(rightsPath)) {
  const rightsLedger = await readFile(rightsPath, "utf8");
  const developmentOnlyIds = rightsLedger
    .split(/\r?\n/u)
    .filter((line) => /^\| `[^`]+`/u.test(line) && line.includes("`APPROVED_DEV`"))
    .map((line) => line.match(/^\| `([^`]+)`/u)?.[1])
    .filter((assetId) => /_[0-9]{3}$/u.test(assetId ?? ""));
  if (developmentOnlyIds.length > 0) {
    const message = `rights remain development-only: ${developmentOnlyIds.join(", ")}`;
    if (strictPublic) failures.push(message);
    else warnings.push(message);
  }
}

const protectionInputs = {
  licenseContents: existsSync(join(root, "LICENSE")) ? await readFile(join(root, "LICENSE"), "utf8") : "",
  codeownersContents: existsSync(join(root, ".github", "CODEOWNERS"))
    ? await readFile(join(root, ".github", "CODEOWNERS"), "utf8")
    : "",
  packageMetadata: existsSync(join(root, "package.json"))
    ? JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    : undefined,
};
failures.push(...validateRepositoryProtection(protectionInputs));

if (failures.length > 0) {
  console.error("Release-readiness audit failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  if (warnings.length > 0) {
    console.error("\nWarnings:\n");
    for (const warning of warnings) console.error(`- ${warning}`);
  }
  process.exit(1);
}

console.log(`Release-readiness audit passed${strictPublic ? " in public-release mode" : " in repository-hygiene mode"}.`);
if (warnings.length > 0) {
  console.log("\nWarnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}
