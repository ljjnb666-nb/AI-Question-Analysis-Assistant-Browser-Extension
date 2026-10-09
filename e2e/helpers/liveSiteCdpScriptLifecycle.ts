/**
 * Passive, narrowly scoped Chrome DevTools Protocol (CDP) evidence.
 *
 * The collector reads ONLY request id, type, URL host/path class and explicitly
 * allowlisted network lifecycle booleans. It never copies/logs headers,
 * cookies, request/response bodies, raw URLs, addresses or stack traces.
 * CDP requestWillBeSentExtraInfo indicates browser header metadata became
 * available; it DOES NOT prove an HTTP request reached a remote server.
 */
type HostClass = "pintiaApex" | "pintiaSubdomain" | "otherHost";
type PathClass = "assets" | "static" | "rootFile" | "otherPath";
type LifecycleStage = "requestObserved" | "headersMetadataObserved" | "responseObserved";
type FailureClass = "aborted" | "timeout" | "dns" | "connection" | "tls" | "blocked" | "other";
type ScriptState = {
  hostClass: HostClass;
  pathClass: PathClass;
  stage: LifecycleStage;
  startedAtMs: number;
};
const MAX_PENDING = 64;
const MAX_COUNTER = 1_000_000;
const inc = (n: number) => Math.min(MAX_COUNTER, n + 1);
const age = (ms: number) => ms < 0 ? "unavailable" : ms < 5_000 ? "under5s" : ms < 17_000 ? "5to17s" : "over17s";
const classes: readonly HostClass[] = ["pintiaApex", "pintiaSubdomain", "otherHost"];
const stages: readonly LifecycleStage[] = ["requestObserved", "headersMetadataObserved", "responseObserved"];
const paths: readonly PathClass[] = ["assets", "static", "rootFile", "otherPath"];

function classifyUrl(untrustedUrl: unknown): Pick<ScriptState, "hostClass" | "pathClass"> {
  try {
    const url = new URL(typeof untrustedUrl === "string" ? untrustedUrl : "");
    const hostname = url.hostname.toLowerCase();
    const hostClass: HostClass = hostname === "pintia.cn"
      ? "pintiaApex"
      : hostname.endsWith(".pintia.cn") ? "pintiaSubdomain" : "otherHost";
    const pathname = url.pathname.toLowerCase();
    const pathClass: PathClass = pathname.startsWith("/assets/")
      ? "assets" : pathname.startsWith("/static/") ? "static"
      : /^\/[^/]+\.(?:js|mjs)$/.test(pathname) ? "rootFile" : "otherPath";
    return { hostClass, pathClass };
  } catch {
    return { hostClass: "otherHost", pathClass: "otherPath" };
  }
}

function classifyFailure(value: unknown): FailureClass {
  if (typeof value !== "string") return "other";
  if (/^net::ERR_ABORTED$/.test(value)) return "aborted";
  if (/^net::ERR_(?:TIMED_OUT|CONNECTION_TIMED_OUT)$/.test(value)) return "timeout";
  if (/^net::ERR_(?:NAME_NOT_RESOLVED|DNS_TIMED_OUT|DNS_SERVER_FAILED)$/.test(value)) return "dns";
  if (/^net::ERR_(?:CONNECTION_RESET|CONNECTION_REFUSED|CONNECTION_CLOSED|INTERNET_DISCONNECTED)$/.test(value)) return "connection";
  if (/^net::ERR_(?:SSL_PROTOCOL_ERROR|CERT_AUTHORITY_INVALID|CERT_DATE_INVALID)$/.test(value)) return "tls";
  if (/^net::ERR_(?:BLOCKED_BY_CLIENT|BLOCKED_BY_RESPONSE)$/.test(value)) return "blocked";
  return "other";
}

export function createCdpScriptLifecycleDiagnostic(now: () => number = () => Date.now()) {
  const pending = new Map<string, ScriptState>();
  let seen = 0;
  let completed = 0;
  let failed = 0;
  let dropped = 0;
  let fromCache = 0;
  let fromServiceWorker = 0;
  let reusedConnection = 0;
  const failures: Record<FailureClass, number> = {
    aborted: 0, timeout: 0, dns: 0, connection: 0, tls: 0, blocked: 0, other: 0,
  };

  return {
    // Input objects are NOT persisted; only the sanitized classifications are.
    requestWillBeSent(event: { requestId?: unknown; type?: unknown; request?: { url?: unknown } }) {
      if (event.type !== "Script" || typeof event.requestId !== "string" || !event.requestId || pending.has(event.requestId)) return;
      seen = inc(seen);
      if (pending.size >= MAX_PENDING) { dropped = inc(dropped); return; }
      const { hostClass, pathClass } = classifyUrl(event.request?.url);
      pending.set(event.requestId, { hostClass, pathClass, stage: "requestObserved", startedAtMs: now() });
    },
    requestWillBeSentExtraInfo(event: { requestId?: unknown }) {
      if (typeof event.requestId !== "string") return;
      const item = pending.get(event.requestId);
      if (item && item.stage === "requestObserved") item.stage = "headersMetadataObserved";
    },
    responseReceived(event: {
      requestId?: unknown;
      response?: { fromDiskCache?: unknown; fromServiceWorker?: unknown; connectionReused?: unknown };
    }) {
      if (typeof event.requestId !== "string") return;
      const item = pending.get(event.requestId);
      if (!item) return;
      item.stage = "responseObserved";
      if (event.response?.fromDiskCache === true) fromCache = inc(fromCache);
      if (event.response?.fromServiceWorker === true) fromServiceWorker = inc(fromServiceWorker);
      if (event.response?.connectionReused === true) reusedConnection = inc(reusedConnection);
    },
    loadingFinished(event: { requestId?: unknown }) {
      if (typeof event.requestId !== "string") return;
      if (pending.delete(event.requestId)) completed = inc(completed);
    },
    loadingFailed(event: { requestId?: unknown; errorText?: unknown }) {
      if (typeof event.requestId !== "string" || !pending.delete(event.requestId)) return;
      failed = inc(failed);
      const failure = classifyFailure(event.errorText);
      failures[failure] = inc(failures[failure]);
    },
    snapshot() {
      const breakdown = classes.flatMap(hostClass => stages.map(stage => ({
        hostClass, stage, count: 0,
      })));
      const pathCounts = paths.map(pathClass => ({ pathClass, count: 0 }));
      let oldestMs = -1;
      const time = now();
      for (const item of pending.values()) {
        const index = breakdown.findIndex(x => x.hostClass === item.hostClass && x.stage === item.stage);
        breakdown[index].count += 1;
        const pathItem = pathCounts.find(x => x.pathClass === item.pathClass);
        if (pathItem) pathItem.count += 1;
        oldestMs = Math.max(oldestMs, Math.max(0, time - item.startedAtMs));
      }
      return {
        schemaVersion: 1,
        observedScriptRequests: seen,
        completedScriptRequests: completed,
        failedScriptRequests: failed,
        droppedScriptEvents: dropped,
        pendingScriptRequests: pending.size,
        oldestPendingAge: age(oldestMs),
        pendingByHostAndStage: breakdown,
        pendingByPathClass: pathCounts,
        responseSources: {
          fromDiskCache: fromCache,
          fromServiceWorker,
          connectionReused: reusedConnection,
        },
        failures: { ...failures },
      };
    },
  };
}
