import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, relative } from "node:path";
import { parseRightsLedgerStatuses, validateManifestRights } from "./release-rights-rules.mjs";

const root = process.cwd();
const strictPublic = process.argv.includes("--strict-public");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".svg", ".ts", ".tsx"]);
const audioExtensions = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav", ".webm"]);
const scanRoots = ["src", "dist/client"];
const directFiles = ["index.html"];
const failures = [];
const audioDirectory = "public/assets/audio";
const audioManifestFile = "audio-manifest.json";
const gameAssetDirectory = "public/assets/game";
const gameAssetManifestFile = "game-asset-manifest.json";
const mobileRuntimeLock = JSON.parse(await readFile(join(root, "mobile-runtime.lock.json"), "utf8"));
const buildBudgets = {
  totalBytes: 3 * 1024 * 1024,
  javascriptChunkBytes: 512 * 1024,
  stylesheetBytes: 128 * 1024,
};

const forbidden = [
  { label: "league abbreviation", pattern: /\bN\s*B\s*A\b/giu },
  { label: "league full name", pattern: /National\s+Basketball\s+Association/giu },
  { label: "competitor brand", pattern: /\bNBA\s*2K\d*\b/giu },
  { label: "official or competitor remote asset", pattern: /https?:\/\/[^\s"')]*(?:nba\.com|2k\.com|cdn\.nba)/giu },
];

async function walk(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (textExtensions.has(extname(entry.name).toLowerCase())) files.push(child);
  }
  return files;
}

async function walkAll(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkAll(child)));
    else files.push(child.replaceAll("\\", "/"));
  }
  return files;
}

const files = [...directFiles];
for (const directory of scanRoots) files.push(...(await walk(directory)));

for (const file of files) {
  const content = await readFile(join(root, file), "utf8");
  for (const rule of forbidden) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(content)) failures.push(`${relative(root, join(root, file))}: ${rule.label}`);
  }
  if (file.startsWith("src")) {
    const remoteUrls = [...content.matchAll(/https?:\/\/[^\s"')`]+/giu)].map((match) => match[0]);
    for (const url of remoteUrls) {
      if (url === "http://www.w3.org/2000/svg") continue;
      failures.push(`${file}: undeclared remote runtime URL ${url}`);
    }
  }
}

const gameAssetManifest = JSON.parse(await readFile(join(root, gameAssetDirectory, gameAssetManifestFile), "utf8"));
const rightsLedger = await readFile(join(root, "docs/rights/rights-ledger.md"), "utf8");
const rightsStatuses = parseRightsLedgerStatuses(rightsLedger);
const declaredGameAssets = new Map(gameAssetManifest.assets?.map((asset) => [asset.file, asset]) ?? []);
const expectedGameAssetFiles = new Set([gameAssetManifestFile, ...declaredGameAssets.keys()]);
const gameAssets = await readdir(join(root, gameAssetDirectory), { withFileTypes: true });
const unexpectedAssets = gameAssets
  .filter((entry) => !entry.isFile() || !expectedGameAssetFiles.has(entry.name))
  .map((entry) => `${gameAssetDirectory}/${entry.name}: unreviewed game asset`);
failures.push(...unexpectedAssets);
if (gameAssetManifest.schemaVersion !== 1 || !["APPROVED_DEV", "APPROVED_RELEASE"].includes(gameAssetManifest.status)) {
  failures.push(`${gameAssetDirectory}/${gameAssetManifestFile}: invalid approval status`);
}
failures.push(...validateManifestRights(gameAssetManifest, rightsLedger, `${gameAssetDirectory}/${gameAssetManifestFile}`, strictPublic));
if (declaredGameAssets.size !== 1 || !declaredGameAssets.has("paper-court.webp")) {
  failures.push(`${gameAssetDirectory}/${gameAssetManifestFile}: expected exactly the reviewed paper-court.webp asset`);
}
for (const [file, record] of declaredGameAssets) {
  const bytes = await readFile(join(root, gameAssetDirectory, file));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== record.sha256) failures.push(`${gameAssetDirectory}/${file}: game asset hash mismatch`);
  if (record.sourcePath) {
    const sourceBytes = await readFile(join(root, record.sourcePath));
    const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
    if (sourceDigest !== record.sourceSha256) failures.push(`${record.sourcePath}: game asset source hash mismatch`);
  }
}

const audioManifest = JSON.parse(await readFile(join(root, audioDirectory, audioManifestFile), "utf8"));
const declaredAudio = new Map(audioManifest.assets?.map((asset) => [asset.file, asset]) ?? []);
const audioEntries = await readdir(join(root, audioDirectory), { withFileTypes: true });
const expectedAudioFiles = new Set([audioManifestFile, ...declaredAudio.keys()]);
for (const entry of audioEntries) {
  if (!entry.isFile() || !expectedAudioFiles.has(entry.name)) failures.push(`${audioDirectory}/${entry.name}: undeclared audio asset`);
}
if (audioManifest.schemaVersion !== 1 || !["APPROVED_DEV", "APPROVED_RELEASE"].includes(audioManifest.status)) {
  failures.push(`${audioDirectory}/${audioManifestFile}: invalid approval status`);
}
failures.push(...validateManifestRights(audioManifest, rightsLedger, `${audioDirectory}/${audioManifestFile}`, strictPublic));
if (audioManifest.license?.id !== "CC0-1.0" || audioManifest.license?.url !== "https://creativecommons.org/publicdomain/zero/1.0/") {
  failures.push(`${audioDirectory}/${audioManifestFile}: unreviewed audio license`);
}
for (const [file, record] of declaredAudio) {
  if (!/^https:\/\/freesound\.org\/people\/[^/]+\/sounds\/\d+\/$/u.test(record.sourcePage ?? "")) {
    failures.push(`${audioDirectory}/${audioManifestFile}: invalid source page for ${file}`);
  }
  if (!/^https:\/\/cdn\.freesound\.org\/previews\//u.test(record.downloadedFrom ?? "")) {
    failures.push(`${audioDirectory}/${audioManifestFile}: invalid download source for ${file}`);
  }
  const bytes = await readFile(join(root, audioDirectory, file));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== record.sha256) failures.push(`${audioDirectory}/${file}: audio hash mismatch`);
}

const reviewedMobileAssetEntries = Object.entries(mobileRuntimeLock)
  .filter(([file]) => file.startsWith("public/assets/"));
const mobileRuntimeRightsStatus = rightsStatuses.get("MOBILE_RUNTIME_ART_001");
if (!mobileRuntimeRightsStatus) failures.push("mobile runtime assets: MOBILE_RUNTIME_ART_001 is absent from the rights ledger");
if (strictPublic && mobileRuntimeRightsStatus !== "APPROVED_RELEASE") {
  failures.push("mobile runtime assets: MOBILE_RUNTIME_ART_001 must be APPROVED_RELEASE for a public build");
}

const expectedPublicAssets = new Set([
  ...reviewedMobileAssetEntries.map(([file]) => file.replaceAll("\\", "/")),
  `${audioDirectory}/${audioManifestFile}`,
  ...[...declaredAudio.keys()].map((file) => `${audioDirectory}/${file}`),
  `${gameAssetDirectory}/${gameAssetManifestFile}`,
  ...[...declaredGameAssets.keys()].map((file) => `${gameAssetDirectory}/${file}`),
]);
for (const file of await walkAll("public/assets")) {
  if (!expectedPublicAssets.has(file)) failures.push(`${file}: public asset is absent from a reviewed manifest or protected runtime lock`);
}

for (const [publicPath, expectedHash] of reviewedMobileAssetEntries) {
  const builtPath = `dist/client/${publicPath.slice("public/".length)}`;
  const builtBytes = await readFile(join(root, builtPath));
  const builtHash = createHash("sha256").update(builtBytes).digest("hex");
  if (builtHash !== expectedHash) failures.push(`${builtPath}: built mobile runtime asset hash mismatch`);
}

const builtAudioDirectory = join(root, "dist/client/assets/audio");
const builtAudioEntries = await readdir(builtAudioDirectory, { withFileTypes: true });
for (const entry of builtAudioEntries) {
  if (!entry.isFile() || !expectedAudioFiles.has(entry.name)) failures.push(`dist/client/assets/audio/${entry.name}: undeclared built audio asset`);
}
for (const [file, record] of declaredAudio) {
  const bytes = await readFile(join(builtAudioDirectory, file));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== record.sha256) failures.push(`dist/client/assets/audio/${file}: built audio hash mismatch`);
}

const builtGameAssetDirectory = join(root, "dist/client/assets/game");
const builtGameAssetEntries = await readdir(builtGameAssetDirectory, { withFileTypes: true });
for (const entry of builtGameAssetEntries) {
  if (!entry.isFile() || !expectedGameAssetFiles.has(entry.name)) failures.push(`dist/client/assets/game/${entry.name}: undeclared built game asset`);
}
for (const [file, record] of declaredGameAssets) {
  const bytes = await readFile(join(builtGameAssetDirectory, file));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== record.sha256) failures.push(`dist/client/assets/game/${file}: built game asset hash mismatch`);
}

const allowedPublicAudio = new Set([...declaredAudio.keys()].map((file) => `${audioDirectory}/${file}`));
const allowedBuiltAudio = new Set([...declaredAudio.keys()].map((file) => `dist/client/assets/audio/${file}`));
for (const file of await walkAll("public")) {
  if (audioExtensions.has(extname(file).toLowerCase()) && !allowedPublicAudio.has(file)) failures.push(`${file}: audio is absent from approved manifest`);
}
for (const file of await walkAll("dist/client")) {
  if (audioExtensions.has(extname(file).toLowerCase()) && !allowedBuiltAudio.has(file)) failures.push(`${file}: built audio is absent from approved manifest`);
}

const builtClientFiles = await walkAll("dist/client");
let builtClientBytes = 0;
let largestJavaScriptChunk = 0;
let largestStylesheet = 0;
for (const file of builtClientFiles) {
  const size = (await readFile(join(root, file))).byteLength;
  builtClientBytes += size;
  if (extname(file).toLowerCase() === ".js") largestJavaScriptChunk = Math.max(largestJavaScriptChunk, size);
  if (extname(file).toLowerCase() === ".css") largestStylesheet = Math.max(largestStylesheet, size);
}
if (builtClientBytes > buildBudgets.totalBytes) failures.push(`dist/client: ${builtClientBytes} bytes exceeds the ${buildBudgets.totalBytes}-byte total budget`);
if (largestJavaScriptChunk > buildBudgets.javascriptChunkBytes) failures.push(`dist/client: JavaScript chunk ${largestJavaScriptChunk} bytes exceeds the ${buildBudgets.javascriptChunkBytes}-byte budget`);
if (largestStylesheet > buildBudgets.stylesheetBytes) failures.push(`dist/client: stylesheet ${largestStylesheet} bytes exceeds the ${buildBudgets.stylesheetBytes}-byte budget`);

for (const file of await walk("src/game")) {
  const content = await readFile(join(root, file), "utf8");
  if (/Math\.random\s*\(/u.test(content)) failures.push(`${file}: non-replayable Math.random usage`);
}

if (failures.length > 0) {
  console.error("Game content compliance check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Game content compliance check passed (${files.length} runtime text files, ${declaredGameAssets.size} reviewed game asset, ${declaredAudio.size} reviewed audio assets; ${(builtClientBytes / 1024 / 1024).toFixed(2)} MiB client, ${(largestJavaScriptChunk / 1024).toFixed(1)} KiB largest JS).`);
