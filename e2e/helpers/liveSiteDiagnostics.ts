/**
 * Privacy-bounded telemetry for an unowned public website.
 *
 * Never retain resource URLs, query parameters, JS error messages, page text,
 * response bodies, console messages, or stack traces in uploaded evidence.
 */
export type ResourceKind = "document" | "script" | "xhr" | "fetch" | "stylesheet" | "image" | "font" | "other";
export type NetworkFailure = "timeout" | "blocked" | "aborted" | "connection" | "other";

type HttpFailure = { resourceKind: ResourceKind; status: number; firstParty: boolean; count: number };
type RequestFailure = { resourceKind: ResourceKind; failure: NetworkFailure; count: number };

const resourceKinds = new Set<ResourceKind>(["document", "script", "xhr", "fetch", "stylesheet", "image", "font"]);
const MAX_GROUPS = 24;

/** Classify owned hostnames without accepting lookalikes such as pintia.cn.evil. */
export function isPintiaPartyHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "pintia.cn" || normalized.endsWith(".pintia.cn");
}

function kind(input: string): ResourceKind {
  return resourceKinds.has(input as ResourceKind) ? input as ResourceKind : "other";
}

function reason(input: string | null | undefined): NetworkFailure {
  // Only allowlisted categories are emitted; never serialize the browser error text.
  if (/TIMED_OUT|TIMEOUT/i.test(input ?? "")) return "timeout";
  if (/BLOCKED|DENIED/i.test(input ?? "")) return "blocked";
  if (/ABORTED|CANCELLED/i.test(input ?? "")) return "aborted";
  if (/CONNECTION|DNS|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED/i.test(input ?? "")) return "connection";
  return "other";
}

export function createLiveSiteDiagnostics() {
  const http = new Map<string, HttpFailure>();
  const requests = new Map<string, RequestFailure>();
  let suppressedHttpFailures = 0;
  let suppressedRequestFailures = 0;
  let pageErrors = 0;
  let consoleErrors = 0;

  return {
    recordHttpFailure(resourceType: string, status: number, firstParty: boolean) {
      if (!Number.isInteger(status) || status < 400 || status > 599) return;
      const resourceKind = kind(resourceType);
      const key = `${resourceKind}:${status}:${firstParty}`;
      const existing = http.get(key);
      if (existing) { existing.count += 1; return; }
      if (http.size >= MAX_GROUPS) { suppressedHttpFailures += 1; return; }
      http.set(key, { resourceKind, status, firstParty, count: 1 });
    },
    recordRequestFailure(resourceType: string, browserError: string | null | undefined) {
      const resourceKind = kind(resourceType);
      const failure = reason(browserError);
      const key = `${resourceKind}:${failure}`;
      const existing = requests.get(key);
      if (existing) { existing.count += 1; return; }
      if (requests.size >= MAX_GROUPS) { suppressedRequestFailures += 1; return; }
      requests.set(key, { resourceKind, failure, count: 1 });
    },
    recordPageError() { pageErrors += 1; },
    recordConsoleError() { consoleErrors += 1; },
    snapshot() {
      return {
        httpFailures: [...http.values()].sort((a, b) => a.resourceKind.localeCompare(b.resourceKind) || a.status - b.status),
        requestFailures: [...requests.values()].sort((a, b) => a.resourceKind.localeCompare(b.resourceKind) || a.failure.localeCompare(b.failure)),
        suppressedHttpFailures,
        suppressedRequestFailures,
        pageErrors,
        consoleErrors,
      };
    },
  };
}

/**
 * Log-safe projection of live-site content readiness. Explicit field picks
 * prevent accidental leakage of the page title, location/search, response
 * bodies, browser errors, and arbitrary future snapshot keys into CI logs.
 * This is diagnostics only; it never changes pass/fail authority.
 */
export function formatLiveSiteReadinessDiagnostic(input: {
  attemptsUsed: number;
  statusCodes: readonly number[];
  snapshots: readonly Readonly<Record<string, unknown>>[];
  telemetry: ReturnType<ReturnType<typeof createLiveSiteDiagnostics>["snapshot"]>;
}): string {
  const boundedInt = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0;
  const allowedKinds = new Set(["document", "script", "xhr", "fetch", "stylesheet", "image", "font", "other"]);
  const allowedReasons = new Set(["timeout", "blocked", "aborted", "connection", "other"]);
  return JSON.stringify({
    schemaVersion: 1,
    attemptsUsed: boundedInt(input.attemptsUsed),
    statusCodes: input.statusCodes.slice(0, 5).map(boundedInt),
    visitSnapshots: input.snapshots.slice(0, 5).map((snapshot) => ({
      snapshotUnavailable: snapshot.snapshotUnavailable === true,
      expectedHost: snapshot.finalHostname === "pintia.cn",
      expectedProblemPath: snapshot.finalPathname === "/problem-sets/434/exam/problems/type/6",
      hasBody: snapshot.hasBody === true,
      readyState: ["loading", "interactive", "complete"].includes(String(snapshot.readyState))
        ? snapshot.readyState : "unknown",
      bodyTextLength: boundedInt(snapshot.bodyTextLength),
      scriptCount: boundedInt(snapshot.scriptCount),
      pendingScriptRequests: boundedInt(snapshot.pendingScriptRequests),
      pendingFirstPartyScripts: boundedInt(snapshot.pendingFirstPartyScripts),
      pendingThirdPartyScripts: boundedInt(snapshot.pendingThirdPartyScripts),
      pendingScriptGraceUsed: snapshot.pendingScriptGraceUsed === true,
      documentTitleSha256: typeof snapshot.documentTitleSha256 === "string" && /^[a-f0-9]{64}$/.test(snapshot.documentTitleSha256)
        ? snapshot.documentTitleSha256 : "",
    })),
    resources: {
      httpFailures: input.telemetry.httpFailures.slice(0, 24).map(({ resourceKind, status, firstParty, count }) => ({
        resourceKind: allowedKinds.has(resourceKind) ? resourceKind : "other",
        status: boundedInt(status), firstParty: firstParty === true, count: boundedInt(count),
      })),
      requestFailures: input.telemetry.requestFailures.slice(0, 24).map(({ resourceKind, failure, count }) => ({
        resourceKind: allowedKinds.has(resourceKind) ? resourceKind : "other",
        failure: allowedReasons.has(failure) ? failure : "other",
        count: boundedInt(count),
      })),
      suppressedHttpFailures: boundedInt(input.telemetry.suppressedHttpFailures),
      suppressedRequestFailures: boundedInt(input.telemetry.suppressedRequestFailures),
      pageErrors: boundedInt(input.telemetry.pageErrors),
      consoleErrors: boundedInt(input.telemetry.consoleErrors),
    },
  });
}
