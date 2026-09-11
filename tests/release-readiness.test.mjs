import assert from "node:assert/strict";
import test from "node:test";
import { findSecretMatches, isScannableTextFile, validateRepositoryProtection } from "../scripts/release-readiness-rules.mjs";
import { parseRightsLedgerStatuses, validateManifestRights } from "../scripts/release-rights-rules.mjs";

test("scans accepted text types regardless of a former 2 MiB cutoff", () => {
  const syntheticToken = "ghp_" + "A".repeat(24);
  const largeText = `${"x".repeat(2 * 1024 * 1024 + 1)}${syntheticToken}`;
  assert.equal(isScannableTextFile("large-generated-source.js"), true);
  assert.deepEqual(findSecretMatches(largeText), ["GitHub token"]);
});

test("does not decode reviewed binary asset types as text", () => {
  assert.equal(isScannableTextFile("paper-court.webp"), false);
  assert.equal(isScannableTextFile("court-dribble.mp3"), false);
});

test("parses explicit asset approval statuses from the rights ledger", () => {
  const ledger = "| `AUDIO_001` | 音频 | 测试 | 来源 | `APPROVED_RELEASE` | gate | 完成 |";
  assert.equal(parseRightsLedgerStatuses(ledger).get("AUDIO_001"), "APPROVED_RELEASE");
});

test("blocks development-only or mismatched manifests from public builds", () => {
  const developmentLedger = "| `AUDIO_001` | 音频 | 测试 | 来源 | `APPROVED_DEV` | gate | 待办 |";
  assert.deepEqual(
    validateManifestRights({ assetId: "AUDIO_001", status: "APPROVED_DEV" }, developmentLedger, "audio", true),
    ["audio: AUDIO_001 must be APPROVED_RELEASE for a public build"],
  );

  const releaseLedger = developmentLedger.replace("APPROVED_DEV", "APPROVED_RELEASE");
  assert.deepEqual(
    validateManifestRights({ assetId: "AUDIO_001", status: "APPROVED_DEV" }, releaseLedger, "audio", false),
    ["audio: manifest status APPROVED_DEV does not match rights ledger status APPROVED_RELEASE"],
  );
});

test("does not allow a missing ledger record or missing manifest asset id", () => {
  assert.deepEqual(
    validateManifestRights({ assetId: "AUDIO_001", status: "APPROVED_RELEASE" }, "", "audio", true),
    ["audio: AUDIO_001 is absent from the rights ledger"],
  );
  assert.deepEqual(
    validateManifestRights({ status: "APPROVED_RELEASE" }, "", "audio", true),
    ["audio: missing top-level assetId"],
  );
});

const validProtection = {
  licenseContents: "《我能打职业》项目作者 All Rights Reserved 玩家娱乐版 非官方 公开可见不代表开源 GitHub 第三方材料 事先书面许可",
  codeownersContents: "* @CaesarWANG54\n/.github/ @CaesarWANG54\n/docs/rights/ @CaesarWANG54\n/LICENSE @CaesarWANG54\n",
  packageMetadata: {
    private: true,
    license: "UNLICENSED",
    author: "《我能打职业》项目作者",
  },
};

test("accepts the confirmed proprietary repository protection contract", () => {
  assert.deepEqual(validateRepositoryProtection(validProtection), []);
});

test("rejects a missing or wrong proprietary owner", () => {
  assert.ok(validateRepositoryProtection({ ...validProtection, licenseContents: "" }).some((failure) => failure.includes("LICENSE")));
  assert.ok(validateRepositoryProtection({
    ...validProtection,
    packageMetadata: { ...validProtection.packageMetadata, author: "Unknown" },
  }).some((failure) => failure.includes("author")));
});

test("rejects unprotected ownership files or publishable package metadata", () => {
  assert.ok(validateRepositoryProtection({ ...validProtection, codeownersContents: "* @someone-else" }).some((failure) => failure.includes("CODEOWNERS")));
  assert.ok(validateRepositoryProtection({
    ...validProtection,
    packageMetadata: { ...validProtection.packageMetadata, private: false, license: "MIT" },
  }).some((failure) => failure.includes("private: true")));
});
