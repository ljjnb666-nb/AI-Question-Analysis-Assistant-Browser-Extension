import { expect, test } from "@playwright/test";
import { createLiveSiteDiagnostics, formatLiveSiteReadinessDiagnostic, isPintiaPartyHost } from "./helpers/liveSiteDiagnostics";

test("PHASE13_DIAG_01 captures only allowlisted network categories and aggregates status", () => {
  const telemetry = createLiveSiteDiagnostics();
  telemetry.recordHttpFailure("fetch", 503, true);
  telemetry.recordHttpFailure("fetch", 503, true);
  telemetry.recordHttpFailure("script", 403, false);
  telemetry.recordHttpFailure("script", 200, false);
  telemetry.recordRequestFailure("xhr", "net::ERR_CONNECTION_RESET?secret=do-not-upload");
  telemetry.recordRequestFailure("xhr", "net::ERR_CONNECTION_RESET?secret=do-not-upload");
  telemetry.recordRequestFailure("unknown", "user-token/private-path");
  telemetry.recordPageError();
  telemetry.recordConsoleError();

  expect(telemetry.snapshot()).toEqual({
    httpFailures: [
      { resourceKind: "fetch", status: 503, firstParty: true, count: 2 },
      { resourceKind: "script", status: 403, firstParty: false, count: 1 },
    ],
    requestFailures: [
      { resourceKind: "other", failure: "other", count: 1 },
      { resourceKind: "xhr", failure: "connection", count: 2 },
    ],
    suppressedHttpFailures: 0,
    suppressedRequestFailures: 0,
    pageErrors: 1,
    consoleErrors: 1,
  });
  expect(JSON.stringify(telemetry.snapshot())).not.toContain("do-not-upload");
  expect(JSON.stringify(telemetry.snapshot())).not.toContain("private-path");
});

test("PHASE13_DIAG_02 bounds hostile resource statuses and never serializes messages", () => {
  const telemetry = createLiveSiteDiagnostics();
  for (let status = 400; status <= 450; status += 1) {
    telemetry.recordHttpFailure("fetch", status, true);
  }
  telemetry.recordRequestFailure("script", "net::ERR_BLOCKED_BY_CLIENT https://secret.invalid/private");
  telemetry.recordRequestFailure("document", "net::ERR_TIMED_OUT user=private");
  telemetry.recordHttpFailure("fetch", 700, true);
  const result = telemetry.snapshot();
  expect(result.httpFailures).toHaveLength(24);
  expect(result.suppressedHttpFailures).toBe(27);
  expect(result.requestFailures).toContainEqual({ resourceKind: "script", failure: "blocked", count: 1 });
  expect(result.requestFailures).toContainEqual({ resourceKind: "document", failure: "timeout", count: 1 });
  expect(JSON.stringify(result)).not.toContain("secret.invalid");
  expect(JSON.stringify(result)).not.toContain("user=private");
});

test("PHASE13_DIAG_03 telemetry alone never certifies a live target as ready", () => {
  const telemetry = createLiveSiteDiagnostics();
  telemetry.recordHttpFailure("script", 404, true);
  const result = telemetry.snapshot();
  expect(result.httpFailures[0].status).toBe(404);
  // Diagnostic data deliberately has no 'ready' or 'pass' field. Real content
  // must still pass the independent expected-title assertion.
  expect(Object.keys(result)).not.toContain("ready");
  expect(Object.keys(result)).not.toContain("passed");
});


test("PHASE13_DIAG_04 distinguishes Pintia API hosts from spoofed suffixes", () => {
  expect(isPintiaPartyHost("pintia.cn")).toBe(true);
  expect(isPintiaPartyHost("API.PINTIA.CN")).toBe(true);
  expect(isPintiaPartyHost("cdn.api.pintia.cn")).toBe(true);
  expect(isPintiaPartyHost("evilpintia.cn")).toBe(false);
  expect(isPintiaPartyHost("pintia.cn.example.invalid")).toBe(false);
});

test("ISSUE83_DIAG_01 log projection includes status/hydration signals without third-party content", () => {
  const telemetry = createLiveSiteDiagnostics();
  telemetry.recordHttpFailure("fetch", 503, true);
  telemetry.recordRequestFailure("script", "net::ERR_BLOCKED_BY_CLIENT user=private-secret");
  const summary = formatLiveSiteReadinessDiagnostic({
    attemptsUsed: 3,
    statusCodes: [200, 200, 200],
    snapshots: [{
      finalHostname: "pintia.cn", finalPathname: "/problem-sets/434/exam/problems/type/6",
      documentTitle: "private-title-token", documentTitleSha256: "a".repeat(64),
      bodyText: "private-body-token", url: "https://private.example/user-token",
      readyState: "complete", bodyTextLength: 42, scriptCount: 8, pendingScriptRequests: 2, hasBody: true,
    }],
    telemetry: telemetry.snapshot(),
  });
  expect(JSON.parse(summary)).toMatchObject({
    schemaVersion: 1, attemptsUsed: 3, statusCodes: [200, 200, 200],
    visitSnapshots: [{
      expectedHost: true, expectedProblemPath: true, hasBody: true,
      readyState: "complete", bodyTextLength: 42, scriptCount: 8,
      documentTitleSha256: "a".repeat(64),
    }],
    resources: {
      httpFailures: [{ resourceKind: "fetch", status: 503, firstParty: true, count: 1 }],
      requestFailures: [{ resourceKind: "script", failure: "blocked", count: 1 }],
    },
  });
  for (const secret of ["private-title-token", "private-body-token", "private.example", "user-token", "private-secret"]) {
    expect(summary).not.toContain(secret);
  }
  expect(summary).not.toContain('"ready":true');
});

test("ISSUE83_DIAG_02 redirects and hostile snapshot metadata do not leak private paths", () => {
  const summary = formatLiveSiteReadinessDiagnostic({
    attemptsUsed: 2, statusCodes: [302, 403],
    snapshots: [{
      finalHostname: "private.example", finalPathname: "/users/private-user",
      documentTitleSha256: "raw-private-title", readyState: "secret-state",
      bodyTextLength: -3, scriptCount: Infinity, hasBody: true,
      networkUrl: "https://private.example/?token=sensitive",
    }],
    telemetry: createLiveSiteDiagnostics().snapshot(),
  });
  expect(JSON.parse(summary).visitSnapshots[0]).toMatchObject({
    expectedHost: false, expectedProblemPath: false,
    readyState: "unknown", bodyTextLength: 0, scriptCount: 0,
    documentTitleSha256: "",
  });
  for (const secret of ["private.example", "private-user", "raw-private-title", "sensitive", "secret-state"]) {
    expect(summary).not.toContain(secret);
  }
});
