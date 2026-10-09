import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import type { ClientRequest } from "node:http";
import type { RequestOptions } from "node:https";

/**
 * Diagnostic-only: the exact pending script's HOST is used in-memory.
 * At most two anonymous HEAD / requests on DISTINCT vetted public A records.
 * This is NOT the script pathname nor the browser's actual connection.
 */
export type ScriptRequestLike = { resourceType(): string; url(): string };
type Mark = "dns" | "tcp" | "tls" | "headers";
type ConnectionOutcome = "response" | "timeout" | "networkError";
type Outcome = ConnectionOutcome | "mixedReachability" | "dnsUnavailable" | "blockedResolution" | "ineligibleHost";
type PublicEvidence = {
  schemaVersion: 1;
  target: "pending-pintia-script-subdomain";
  requestMethod: "HEAD";
  requestPath: "/";
  outcome: Outcome;
  httpStatusClass: "none" | "2xx" | "3xx" | "4xx" | "5xx" | "other";
  totalLatencyBucket: "under1s" | "1to3s" | "over3s";
  milestones: Array<{ phase: Mark; observed: boolean; latencyBucket: "unobserved" | "under1s" | "1to3s" | "over3s" }>;
  /** Public counts, never IPs: at most two fresh connections on two DIFFERENT public A answers. */
  publicIpv4AnswerCount: number;
  addressComparisons: Array<{
    slot: "first" | "second";
    outcome: ConnectionOutcome;
    httpStatusClass: PublicEvidence["httpStatusClass"];
    milestones: PublicEvidence["milestones"];
  }>;
};
const phases: readonly Mark[] = ["dns", "tcp", "tls", "headers"];

function validScriptSubdomain(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host.length > 253 || !/^(?:[a-z0-9-]+\.)+pintia\.cn$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function createPendingPintiaScriptHostTracker() {
  const pending = new Map<ScriptRequestLike, string>();
  return {
    started(request: ScriptRequestLike) {
      if (request.resourceType() !== "script" || pending.has(request) || pending.size >= 64) return;
      const hostname = validScriptSubdomain(request.url());
      if (hostname) pending.set(request, hostname);
    },
    finished(request: ScriptRequestLike) { pending.delete(request); },
    failed(request: ScriptRequestLike) { pending.delete(request); },
    /** Private return value; NEVER directly serialize the chosen hostname. */
    pendingHost(): string | null { return pending.values().next().value ?? null; },
    publicSummary() {
      return {
        eligiblePendingScripts: pending.size,
        distinctPendingSubdomainCount: new Set(pending.values()).size,
      };
    },
  };
}

/** Reject known non-public/reserved IPv4 ranges before making a new connection. */
export function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && [0, 88, 168].includes(b)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}
function latency(ms: number) {
  if (ms < 1_000) return "under1s" as const;
  if (ms < 3_000) return "1to3s" as const;
  return "over3s" as const;
}
function statusClass(status: number | null): PublicEvidence["httpStatusClass"] {
  if (status === null || !Number.isInteger(status)) return "none";
  if (status >= 200 && status <= 599) return `${Math.floor(status / 100)}xx` as PublicEvidence["httpStatusClass"];
  return "other";
}

/**
 * One global 6s budget, including DNS. Probe at most two DISTINCT vetted
 * public IPv4 candidates in parallel and report only fixed-index safe enums.
 * This does not replay browser script URL, and never changes site test authority.
 * Errors AFTER successful DNS must not be misreported as DNS failures.
 */
export async function probePendingPintiaScriptHost(
  hostname: string | null,
  options: {
    now?: () => number;
    resolve?: (hostname: string) => Promise<readonly { address: string; family: number }[]>;
    request?: (options: RequestOptions) => ClientRequest;
    timeoutMs?: number;
  } = {},
): Promise<PublicEvidence> {
  const now = options.now ?? Date.now;
  const start = now();
  const dnsMarks: Partial<Record<Mark, number>> = {};
  type Connection = {
    slot: "first" | "second";
    marks: Partial<Record<Mark, number>>;
    outcome: ConnectionOutcome | null;
    status: number | null;
    request?: ClientRequest;
  };
  let publicIpv4AnswerCount = 0;
  const attempts: Connection[] = [];
  const timings = (marks: Partial<Record<Mark, number>>) => phases.map(phase => ({
    phase, observed: marks[phase] !== undefined,
    latencyBucket: marks[phase] === undefined
      ? "unobserved" as const : latency(Math.max(0, marks[phase] - start)),
  }));
  const evidence = (outcome: Outcome, code: number | null): PublicEvidence => ({
    schemaVersion: 1, target: "pending-pintia-script-subdomain",
    requestMethod: "HEAD", requestPath: "/", outcome,
    httpStatusClass: statusClass(code),
    totalLatencyBucket: latency(Math.max(0, now() - start)),
    milestones: timings({ ...dnsMarks, ...(attempts[0]?.marks ?? {}) }),
    publicIpv4AnswerCount,
    addressComparisons: attempts.map(a => ({
      slot: a.slot,
      outcome: a.outcome ?? "timeout",
      httpStatusClass: statusClass(a.status),
      milestones: timings({ ...dnsMarks, ...a.marks }),
    })),
  });
  if (!hostname || validScriptSubdomain(`https://${hostname}/`) !== hostname) {
    return evidence("ineligibleHost", null);
  }
  const budget = options.timeoutMs ?? 6_000;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 10_000) {
    throw new Error("ISSUE83_SCRIPT_HOST_PROBE_BUDGET_INVALID");
  }
  const resolver = options.resolve ?? ((host: string) => lookup(host, { all: true, family: 4 }));
  const transport = options.request ?? https.request;

  return await new Promise<PublicEvidence>((resolve) => {
    let settled = false;
    let launchComplete = false;
    const finishAll = (override?: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A timeout is recorded only for candidates still outstanding.
      for (const attempt of attempts) {
        if (attempt.outcome === null) {
          attempt.outcome = "timeout";
          attempt.request?.destroy();
        }
      }
      const first = attempts[0];
      const outcomes = attempts.map(a => a.outcome);
      const mixed = outcomes.includes("response") && outcomes.some(x => x !== "response");
      resolve(evidence(
        mixed ? "mixedReachability" : override ?? first?.outcome ?? "dnsUnavailable",
        first?.status ?? null,
      ));
    };
    const timer = setTimeout(() => finishAll("timeout"), budget);
    const finished = (attempt: Connection, outcome: ConnectionOutcome, code: number | null = null) => {
      if (settled || attempt.outcome !== null) return;
      attempt.outcome = outcome;
      attempt.status = code;
      if (launchComplete && attempts.length > 0 && attempts.every(a => a.outcome !== null)) finishAll();
    };
    Promise.resolve().then(() => resolver(hostname)).then((answers) => {
      if (settled) return;
      // Don't follow DNS answers into private addresses, even if another
      // record is public. Reject large unexpected DNS sets fail-closed.
      if (!answers.length || answers.length > 32 || !answers.some(a => a.family === 4)) {
        finishAll("dnsUnavailable");
        return;
      }
      if (answers.some(a => a.family !== 4 || !isPublicIpv4(a.address))) {
        finishAll("blockedResolution");
        return;
      }
      dnsMarks.dns = now();
      const distinct = [...new Set(answers.map(a => a.address))];
      publicIpv4AnswerCount = distinct.length;
      for (const [i, address] of distinct.slice(0, 2).entries()) {
        const attempt: Connection = {
          slot: i === 0 ? "first" : "second",
          marks: {}, outcome: null, status: null,
        };
        attempts.push(attempt);
        try {
          // IP is validated and pinned. TLS SNI + Host remain target's real
          // hostname to preserve certificate/HTTP routing checks.
          const request = transport({
            protocol: "https:", hostname: address, servername: hostname, port: 443,
            method: "HEAD", path: "/", agent: false, rejectUnauthorized: true,
            headers: { Host: hostname, Accept: "*/*" },
          });
          attempt.request = request;
          request.once("socket", socket => {
            socket.once("connect", () => { attempt.marks.tcp ??= now(); });
            socket.once("secureConnect", () => { attempt.marks.tls ??= now(); });
          });
          request.once("response", response => {
            attempt.marks.headers ??= now();
            response.resume();
            finished(attempt, "response", response.statusCode ?? null);
          });
          request.once("error", () => finished(attempt, "networkError"));
          request.end();
        } catch {
          // This is a transport/setup failure, never a DNS failure.
          attempt.request?.destroy();
          finished(attempt, "networkError");
        }
      }
      launchComplete = true;
      if (attempts.length > 0 && attempts.every(a => a.outcome !== null)) finishAll();
    }).catch(() => {
      // Resolver rejected before any connection attempt.
      if (!settled) finishAll("dnsUnavailable");
    });
  });
}
