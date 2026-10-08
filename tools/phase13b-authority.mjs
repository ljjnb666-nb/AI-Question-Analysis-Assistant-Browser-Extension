import { createHmac, randomBytes } from "node:crypto";

export const PHASE13B_SITES = Object.freeze(["zhihuishu", "polymas", "pintia"]);

function reject(message) {
  throw new Error(message);
}

export function parsePhase13bArgs(argv, isTTY) {
  if (!isTTY) reject("INTERACTIVE_TERMINAL_REQUIRED");
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--consent-readonly") {
      if (values.consent) reject("DUPLICATE_ARGUMENT");
      values.consent = true;
      continue;
    }
    if (!["--site", "--url"].includes(flag)) reject("UNKNOWN_ARGUMENT");
    if (values[flag]) reject("DUPLICATE_ARGUMENT");
    const value = argv[++index];
    if (!value || value.startsWith("--")) reject("MISSING_ARGUMENT_VALUE");
    values[flag] = value;
  }
  if (!values.consent) reject("EXPLICIT_CONSENT_REQUIRED");
  const site = values["--site"];
  if (!PHASE13B_SITES.includes(site)) reject("UNSUPPORTED_SITE_IDENTIFIER");
  if (!values["--url"]) reject("TARGET_URL_REQUIRED");
  let url;
  try {
    url = new URL(values["--url"]);
  } catch {
    reject("INVALID_TARGET_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) reject("HTTPS_TARGET_REQUIRED");
  if (url.pathname !== "/" || url.search || url.hash) reject("ORIGIN_ONLY_REQUIRED");
  if (url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
    reject("PUBLIC_HTTPS_DOMAIN_REQUIRED");
  }
  if (site === "zhihuishu" && !(url.hostname === "zhihuishu.com" || url.hostname.endsWith(".zhihuishu.com"))) {
    reject("SITE_ORIGIN_MISMATCH");
  }
  if (site === "pintia" && !(url.hostname === "pintia.cn" || url.hostname.endsWith(".pintia.cn"))) {
    reject("SITE_ORIGIN_MISMATCH");
  }
  return { site, url, consent: true };
}

export function makeStateDigest(controls, ephemeralKey) {
  return createHmac("sha256", ephemeralKey).update(JSON.stringify(controls)).digest("hex");
}

export function newEphemeralKey() {
  return randomBytes(32);
}

export function examineReadOnlyObservation(observation) {
  if (!observation.userAttested) return "USER_AUTH_ATTESTATION_MISSING";
  if (observation.originBefore !== observation.originAfter) return "ORIGIN_CHANGED";
  if (observation.urlBefore !== observation.urlAfter) return "ROUTE_CHANGED";
  if (!observation.snapshot || observation.snapshot.originUrl !== observation.urlAfter) return "WORKSPACE_ORIGIN_MISMATCH";
  if (observation.snapshot.detection?.phase !== "completed") return "DETECTION_NOT_COMPLETE";
  if (!Array.isArray(observation.snapshot.candidates) || observation.snapshot.candidates.length < 1) return "NO_CANDIDATE_DETECTED";
  if (observation.monitorAlive !== true) return "PAGE_MONITOR_LOST";
  if (observation.events?.length) return "PAGE_INTERACTION_OBSERVED";
  if (observation.blockedWrites !== 0) return "NETWORK_WRITE_ATTEMPTED";
  if (observation.formCountBefore !== observation.formCountAfter) return "PAGE_FORM_STRUCTURE_CHANGED";
  if (observation.digestBefore !== observation.digestAfter) return "PAGE_CONTROL_STATE_CHANGED";
  return null;
}

export function createRedactedEvidence(observation, failureCode) {
  const candidates = observation.snapshot?.candidates ?? [];
  const valid = failureCode === null;
  return {
    schemaVersion: 1,
    authority: "LOCAL_USER_ATTESTED_AUTH_READONLY",
    result: valid ? "LOCAL_READONLY_PASS" : "LOCAL_READONLY_FAIL",
    failureCode: failureCode ?? null,
    siteId: observation.site,
    sourceSha: observation.sourceSha,
    extensionVersion: observation.extensionVersion,
    extensionTreeSha256: observation.extensionTreeSha256,
    browserName: "chromium",
    login: "USER_ATTESTED_NOT_INDEPENDENTLY_VERIFIED",
    detectionPhase: observation.snapshot?.detection?.phase ?? "not_observed",
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 100).map(entry => ({
      type: ["single_choice", "multiple_choice", "short_answer", "true_false", "fill_blank", "programming", "essay", "unknown"].includes(entry.block?.questionTypeGuess) ? entry.block.questionTypeGuess : "unknown",
      previewLength: Number(entry.block?.previewText?.length ?? 0),
      identityPresent: Boolean(entry.block?.identity?.stableId),
      fingerprintPresent: Boolean(entry.block?.identity?.contentFingerprint),
    })),
    pageIntegrity: {
      urlUnchanged: observation.urlBefore === observation.urlAfter,
      controlStateUnchanged: observation.digestBefore === observation.digestAfter,
      formCountUnchanged: observation.formCountBefore === observation.formCountAfter,
      interactionEventCount: observation.events?.length ?? 0,
      blockedWriteRequestCount: observation.blockedWrites,
      answerFillAttempted: false,
      automaticSubmissionObserved: false,
    },
    limitations: [
      "Authenticated session status is user-attested, not independently verified",
      "Only read-only detector behavior is covered; solving and answer filling are NOT TESTED",
      "Local evidence must not be uploaded to CI or a public issue without review",
    ],
  };
}
