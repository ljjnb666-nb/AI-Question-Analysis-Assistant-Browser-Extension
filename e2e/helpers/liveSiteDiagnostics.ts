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
