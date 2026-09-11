const RIGHTS_STATUSES = ["BLOCKED", "REVIEW", "APPROVED_DEV", "APPROVED_RELEASE", "REPLACE", "EXPIRED"];

export function parseRightsLedgerStatuses(contents) {
  const statuses = new Map();
  for (const line of contents.split(/\r?\n/u)) {
    const assetId = line.match(/^\| `([^`]+)`/u)?.[1];
    if (!assetId) continue;
    const status = RIGHTS_STATUSES.find((candidate) => line.includes(`\`${candidate}\``));
    if (status) statuses.set(assetId, status);
  }
  return statuses;
}

export function validateManifestRights(manifest, ledgerContents, label, strictPublic = false) {
  const failures = [];
  const assetId = typeof manifest.assetId === "string" ? manifest.assetId : "";
  if (!assetId) return [`${label}: missing top-level assetId`];

  const ledgerStatus = parseRightsLedgerStatuses(ledgerContents).get(assetId);
  if (!ledgerStatus) failures.push(`${label}: ${assetId} is absent from the rights ledger`);
  if (ledgerStatus && ledgerStatus !== manifest.status) {
    failures.push(`${label}: manifest status ${manifest.status} does not match rights ledger status ${ledgerStatus}`);
  }
  if (strictPublic && manifest.status !== "APPROVED_RELEASE") {
    failures.push(`${label}: ${assetId} must be APPROVED_RELEASE for a public build`);
  }
  return failures;
}
