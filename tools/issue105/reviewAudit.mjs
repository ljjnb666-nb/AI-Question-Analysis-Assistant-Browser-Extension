import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/** Independent review-gate for real, private screenshot benchmark inputs.
 * These are self-reported capture/review attestations, NOT independently verified Edge evidence.
 * Never use this module to authorize Fill/Submit.
 */
export const REVIEW_VERSION = "issue105-r2b-review-v1";
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const ALIAS = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = reason => { throw new Error("ISSUE105_REVIEW_GATE_INVALID: " + reason); };
const canonicalText = value => typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : null;
const timestamp = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const truthStatus = t => {
  if (!object(t) || !["readable", "unreadable"].includes(t.status)) return false;
  if (t.status === "unreadable") return ["missing_labels","occluded","ambiguous","unreadable_text"].includes(t.reason);
  if (typeof t.stem !== "string" || !t.stem.trim() || t.stem.length > 1400 ||
      !Array.isArray(t.options) || t.options.length !== 4) return false;
  return t.options.every((v,i) => object(v) &&
    v.key === "ABCD"[i] && typeof v.text === "string" &&
    v.text.trim() && v.text.length <= 240);
};
function sameTruth(a,b) {
  if (!truthStatus(a) || !truthStatus(b) || a.status !== b.status) return false;
  if (a.status === "unreadable") return a.reason === b.reason;
  return canonicalText(a.stem) === canonicalText(b.stem) &&
    a.options.every((o,i) => o.key === b.options[i].key &&
      canonicalText(o.text) === canonicalText(b.options[i].text));
}
function checkCapture(sample) {
  const { caseId:id, evidence:e, capture:c, observation:o } = sample;
  if (!object(c) || c.client !== "microsoft_edge" || c.captureMethod !== "manual_capture" ||
      c.sourcePolicy !== "public_or_authorized" || c.siteId !== sample.siteId ||
      !ALIAS.test(c.sessionAlias ?? "") || !timestamp(c.capturedAt) ||
      !COMMIT_SHA.test(c.extensionCommit ?? "") ||
      !SHA256.test(c.extensionArtifactSha256 ?? "")) {
    invalid(id + ": incomplete Edge capture provenance claim");
  }
  if (!object(o) || o.blockSource !== "manual_capture" || !["vision","hybrid"].includes(o.routeUsed)) {
    invalid(id + ": real screenshot must use manual visual route");
  }
  if (!object(e) || !SHA256.test(e.sha256 ?? "") || e.kind !== "real_edge_screenshot") {
    invalid(id + ": missing screenshot image binding");
  }
}
function checkReview(row) {
  if (!object(row) || !ALIAS.test(row.caseId ?? "") || !ALIAS.test(row.reviewerAlias ?? "") ||
      !timestamp(row.reviewedAt) || !SHA256.test(row.imageSha256 ?? "") || !truthStatus(row.truth) ||
      row.method !== "independent_pixel_annotation") invalid("invalid review entry");
}
export function readReviewBundle(file) {
  const size = statSync(file).size;
  if (size < 2 || size > 2 * 1024 * 1024) invalid("review bundle must be 2B..2MiB");
  return JSON.parse(readFileSync(file, "utf8"));
}
/**
 * Requires EXACTLY two consistent independent records per real sample and a dataset byte hash.
 * This catches accidental leakage/corruption/disagreement but cannot independently prove
 * screenshot source, actual browser used, or human independence.
 */
export function auditRealReviewEvidence(dataset, { datasetBytes, reviews } = {}) {
  if (!object(dataset) || !Array.isArray(dataset.samples)) invalid("invalid dataset");
  const real = dataset.samples.filter(s => object(s) && object(s.evidence) && s.evidence.kind === "real_edge_screenshot");
  if (real.length === 0) {
    if (reviews !== undefined) invalid("review bundle supplied without real screenshot samples");
    return { state: "NO_REAL_SAMPLES", reviewed: 0, reviewersPerCase: 0 };
  }
  if (!object(reviews) || reviews.version !== REVIEW_VERSION || reviews.datasetId !== dataset.datasetId ||
      !SHA256.test(reviews.datasetSha256 ?? "") || !Array.isArray(reviews.entries) ||
      !Buffer.isBuffer(datasetBytes)) invalid("real screenshots require bound review bundle and dataset bytes");
  if (createHash("sha256").update(datasetBytes).digest("hex") !== reviews.datasetSha256) {
    invalid("review bundle dataset SHA256 mismatch");
  }
  if (reviews.entries.length !== real.length * 2) invalid("expected exactly two reviews per real case");
  const map = new Map(), caseIds = new Set(real.map(s => s.caseId));
  for (const entry of reviews.entries) {
    checkReview(entry);
    if (!caseIds.has(entry.caseId)) invalid("review for unknown/non-real case");
    const rows = map.get(entry.caseId) ?? [];
    if (rows.some(r => r.reviewerAlias === entry.reviewerAlias) || rows.length >= 2) {
      invalid(entry.caseId + ": duplicate reviewer or excess review");
    }
    rows.push(entry);
    map.set(entry.caseId,rows);
  }
  for (const sample of real) {
    checkCapture(sample);
    const rows = map.get(sample.caseId);
    if (!rows || rows.length !== 2) invalid(sample.caseId + ": insufficient independent review records");
    const capturedAt = Date.parse(sample.capture.capturedAt);
    for (const row of rows) {
      if (row.imageSha256 !== sample.evidence.sha256) invalid(sample.caseId + ": review image digest mismatch");
      if (Date.parse(row.reviewedAt) < capturedAt) invalid(sample.caseId + ": review predates capture");
    }
    if (!sameTruth(rows[0].truth,rows[1].truth)) invalid(sample.caseId + ": independent reviewers disagree");
    if (!sameTruth(sample.truth,rows[0].truth)) invalid(sample.caseId + ": dataset truth differs from reviewers");
  }
  return { state: "TWO_REVIEWER_CONSENSUS_SELF_ATTESTED_NOT_EDGE_ACCEPTANCE",
    reviewed: real.length, reviewersPerCase: 2, datasetHashVerified: true };
}
