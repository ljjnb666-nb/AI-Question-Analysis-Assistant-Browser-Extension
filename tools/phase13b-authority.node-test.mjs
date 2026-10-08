import assert from "node:assert/strict";
import test from "node:test";
import {
  createRedactedEvidence,
  examineReadOnlyObservation,
  makeStateDigest,
  newEphemeralKey,
  parsePhase13bArgs,
} from "./phase13b-authority.mjs";

const args = (site, url) => ["--site", site, "--url", url, "--consent-readonly"];
const baseObservation = () => ({
  site: "zhihuishu",
  sourceSha: "a".repeat(40),
  extensionVersion: "0.2.0",
  extensionTreeSha256: "b".repeat(64),
  userAttested: true,
  originBefore: "https://online.zhihuishu.com",
  originAfter: "https://online.zhihuishu.com",
  urlBefore: "https://online.zhihuishu.com/class?token=PRIVATE",
  urlAfter: "https://online.zhihuishu.com/class?token=PRIVATE",
  snapshot: {
    originUrl: "https://online.zhihuishu.com/class?token=PRIVATE",
    detection: { phase: "completed" },
    candidates: [{
      block: {
        previewText: "PRIVATE_QUESTION_CONTENT",
        questionTypeGuess: "single_choice",
        identity: { stableId: "PRIVATE_STABLE_ID", contentFingerprint: "PRIVATE_FINGERPRINT" },
      },
    }],
  },
  events: [],
  blockedWrites: 0,
  formCountBefore: 1,
  formCountAfter: 1,
  digestBefore: "1".repeat(64),
  digestAfter: "1".repeat(64),
});

test("13B-CONTRACT-01 requires a TTY, exact consent and supported site origin", () => {
  assert.throws(() => parsePhase13bArgs(args("zhihuishu", "https://online.zhihuishu.com/"), false), /INTERACTIVE_TERMINAL_REQUIRED/);
  assert.throws(() => parsePhase13bArgs(["--site", "zhihuishu", "--url", "https://online.zhihuishu.com/"], true), /EXPLICIT_CONSENT_REQUIRED/);
  assert.throws(() => parsePhase13bArgs(args("unknown", "https://example.com"), true), /UNSUPPORTED_SITE_IDENTIFIER/);
  assert.throws(() => parsePhase13bArgs(args("zhihuishu", "https://example.com"), true), /SITE_ORIGIN_MISMATCH/);
  assert.throws(() => parsePhase13bArgs(args("pintia", "http://pintia.cn"), true), /HTTPS_TARGET_REQUIRED/);
  assert.throws(() => parsePhase13bArgs(args("pintia", "https://user:pass@pintia.cn"), true), /HTTPS_TARGET_REQUIRED/);
  assert.throws(() => parsePhase13bArgs(args("pintia", "https://127.0.0.1"), true), /PUBLIC_HTTPS_DOMAIN_REQUIRED/);
  assert.throws(() => parsePhase13bArgs([...args("pintia", "https://pintia.cn"), "--consent-readonly"], true), /DUPLICATE_ARGUMENT/);
  assert.equal(parsePhase13bArgs(args("pintia", "https://pintia.cn/"), true).site, "pintia");
});

test("13B-CONTRACT-02 HMAC is session-keyed and changes with control state", () => {
  const key = newEphemeralKey(), anotherKey = newEphemeralKey();
  const controls = [{ value: "PRIVATE_ANSWER", checked: false }];
  assert.equal(makeStateDigest(controls, key), makeStateDigest(controls, key));
  assert.notEqual(makeStateDigest(controls, key), makeStateDigest(controls, anotherKey));
  assert.notEqual(makeStateDigest(controls, key), makeStateDigest([{ value: "CHANGED", checked: false }], key));
});

test("13B-CONTRACT-03 read-only authority succeeds only on fully preserved state", () => {
  assert.equal(examineReadOnlyObservation(baseObservation()), null);
});

for (const [label, patch, expected] of [
  ["attestation", { userAttested: false }, "USER_AUTH_ATTESTATION_MISSING"],
  ["origin", { originAfter: "https://other.example.com" }, "ORIGIN_CHANGED"],
  ["route", { urlAfter: "https://online.zhihuishu.com/other" }, "ROUTE_CHANGED"],
  ["no snapshot", { snapshot: undefined }, "WORKSPACE_ORIGIN_MISMATCH"],
  ["interactions", { events: ["submit"] }, "PAGE_INTERACTION_OBSERVED"],
  ["network write", { blockedWrites: 1 }, "NETWORK_WRITE_ATTEMPTED"],
  ["control mutation", { digestAfter: "2".repeat(64) }, "PAGE_CONTROL_STATE_CHANGED"],
  ["form added", { formCountAfter: 2 }, "PAGE_FORM_STRUCTURE_CHANGED"],
]) {
  test(`13B-CONTRACT-04 fail closed on ${label}`, () => {
    assert.equal(examineReadOnlyObservation({ ...baseObservation(), ...patch }), expected);
  });
}

test("13B-CONTRACT-05 detection failure and empty candidates fail closed", () => {
  const observation = baseObservation();
  observation.snapshot.detection.phase = "detecting";
  assert.equal(examineReadOnlyObservation(observation), "DETECTION_NOT_COMPLETE");
  observation.snapshot.detection.phase = "completed";
  observation.snapshot.candidates = [];
  assert.equal(examineReadOnlyObservation(observation), "NO_CANDIDATE_DETECTED");
});

test("13B-CONTRACT-06 redacted evidence never contains URL, credentials, question or identity", () => {
  const sample = baseObservation();
  const evidence = createRedactedEvidence(sample, examineReadOnlyObservation(sample));
  const json = JSON.stringify(evidence);
  assert.equal(evidence.result, "LOCAL_READONLY_PASS");
  for (const marker of ["PRIVATE", "token=", "online.zhihuishu.com", "class?", "COOKIE", "PRIVATE_ANSWER"]) {
    assert.equal(json.includes(marker), false, `leaked ${marker}`);
  }
  assert.equal(evidence.pageIntegrity.automaticSubmissionObserved, false);
  assert.equal(evidence.pageIntegrity.answerFillAttempted, false);
  assert.equal(evidence.candidates[0].previewLength, 24);
});

test("13B-CONTRACT-07 failing evidence cannot misrepresent itself as PASS", () => {
  const sample = { ...baseObservation(), events: ["submit"] };
  const failureCode = examineReadOnlyObservation(sample);
  const evidence = createRedactedEvidence(sample, failureCode);
  assert.equal(failureCode, "PAGE_INTERACTION_OBSERVED");
  assert.equal(evidence.result, "LOCAL_READONLY_FAIL");
  assert.equal(evidence.failureCode, failureCode);
});
