import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import type { ClientRequest, RequestOptions } from "node:http";

/**
 * Diagnostic-only: the exact pending script's HOST is used in-memory.
 * The only extra network operation is one anonymous HEAD / on that host.
 * This is NOT the script pathname nor the browser's actual connection.
 */
export type ScriptRequestLike = { resourceType(): string; url(): string };
type Mark = "dns" | "tcp" | "tls" | "headers";
type Outcome =
  | "response" | "timeout" | "networkError"
  | "dnsUnavailable" | "blockedResolution" | "ineligibleHost";
type PublicEvidence = {
  schemaVersion: 1;
  target: "pending-pintia-script-subdomain";
  requestMethod: "HEAD";
  requestPath: "/";
  outcome: Outcome;
  httpStatusClass: "none" | "2xx" | "3xx" | "4xx" | "5xx" | "other";
  totalLatencyBucket: "under1s" | "1to3s" | "over3s";
  milestones: Array<{ phase: Mark; observed: boolean; latencyBucket: "unobserved" | "under1s" | "1to3s" | "over3s" }>;
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
  const marks: Partial<Record<Mark, number>> = {};
  const finish = (outcome: Outcome, httpStatus: number | null): PublicEvidence => ({
    schemaVersion: 1, target: "pending-pintia-script-subdomain",
    requestMethod: "HEAD", requestPath: "/", outcome,
    httpStatusClass: statusClass(httpStatus),
    totalLatencyBucket: latency(Math.max(0, now() - start)),
    milestones: phases.map(phase => ({
      phase, observed: marks[phase] !== undefined,
      latencyBucket: marks[phase] === undefined ? "unobserved" : latency(Math.max(0, marks[phase] - start)),
    })),
  });
  if (!hostname || validScriptSubdomain(`https://${hostname}/`) !== hostname) {
    return finish("ineligibleHost", null);
  }
  const budget = options.timeoutMs ?? 6_000;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 10_000) {
    throw new Error("ISSUE83_SCRIPT_HOST_PROBE_BUDGET_INVALID");
  }
  const resolver = options.resolve ?? ((host: string) => lookup(host, { all: true, family: 4 }));
  const transport = options.request ?? https.request;
  return await new Promise<PublicEvidence>((resolve) => {
    let settled = false;
    let request: ClientRequest | undefined;
    const done = (outcome: Outcome, code: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(finish(outcome, code));
    };
    // Covers the entire DNS + TCP + TLS + response wait. No retry.
    const timer = setTimeout(() => {
      done("timeout");
      request?.destroy();
    }, budget);
    Promise.resolve().then(() => resolver(hostname)).then((answers) => {
      if (settled) return;
      if (!answers.length || !answers.some(a => a.family === 4)) { done("dnsUnavailable"); return; }
      // Reject mixed private/public DNS answers; prevents DNS rebinding SSRF.
      if (answers.some(a => a.family !== 4 || !isPublicIpv4(a.address))) {
        done("blockedResolution"); return;
      }
      marks.dns = now();
      const selected = answers[0].address;
      request = transport({
        protocol: "https:", hostname, servername: hostname, port: 443,
        method: "HEAD", path: "/", agent: false, rejectUnauthorized: true,
        // Pin previously verified public IP: no implicit second DNS lookup.
        lookup: (_host, _opt, callback) => callback(null, selected, 4),
        headers: { Accept: "*/*" },
      });
      request.once("socket", (socket) => {
        socket.once("connect", () => { marks.tcp ??= now(); });
        socket.once("secureConnect", () => { marks.tls ??= now(); });
      });
      request.once("response", (response) => {
        marks.headers ??= now();
        response.resume();
        done("response", response.statusCode ?? null);
      });
      request.once("error", () => done("networkError"));
      request.end();
    }).catch(() => done("dnsUnavailable"));
  });
}
