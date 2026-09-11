import { extname } from "node:path";

const textExtensions = new Set([
  "", ".cjs", ".css", ".html", ".js", ".json", ".lock", ".md", ".mjs", ".ps1", ".sh", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);

const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/u],
  ["GitLab token", /glpat-[A-Za-z0-9_-]{20,}/u],
  ["AWS access key", /AKIA[0-9A-Z]{16}/u],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/u],
  ["npm access token", /npm_[A-Za-z0-9]{30,}/u],
  ["OpenAI-style secret", /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/u],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/u],
  ["Stripe live secret", /sk_live_[A-Za-z0-9]{16,}/u],
  ["Discord webhook", /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/u],
];

export function isScannableTextFile(fileName) {
  return textExtensions.has(extname(fileName).toLowerCase());
}

export function findSecretMatches(contents) {
  return secretPatterns.filter(([, pattern]) => pattern.test(contents)).map(([label]) => label);
}

export function validateRepositoryProtection({ licenseContents, codeownersContents, packageMetadata }) {
  const failures = [];
  const requiredLicenseFragments = [
    "《我能打职业》项目作者",
    "All Rights Reserved",
    "玩家娱乐版",
    "非官方",
    "公开可见不代表开源",
    "GitHub",
    "第三方材料",
    "事先书面许可",
  ];
  for (const fragment of requiredLicenseFragments) {
    if (!licenseContents.includes(fragment)) failures.push(`proprietary LICENSE is missing: ${fragment}`);
  }

  const requiredCodeownerFragments = [
    "* @CaesarWANG54",
    "/.github/ @CaesarWANG54",
    "/docs/rights/ @CaesarWANG54",
    "/LICENSE @CaesarWANG54",
  ];
  for (const fragment of requiredCodeownerFragments) {
    if (!codeownersContents.includes(fragment)) failures.push(`CODEOWNERS is missing: ${fragment}`);
  }

  if (packageMetadata?.private !== true) failures.push("package.json must keep private: true to block accidental npm publication");
  if (packageMetadata?.license !== "UNLICENSED") failures.push("package.json license must be UNLICENSED for the proprietary repository");
  if (packageMetadata?.author !== "《我能打职业》项目作者") failures.push("package.json author must match the project author identity");
  return failures;
}
