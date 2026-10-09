import https from "node:https";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * A fixed-origin, anonymous, single-request network-layer comparison only.
 * NEVER re-request the third-party script URL or inherit page cookies/headers.
 * A successful apex HEAD does not establish script-CDN/asset reachability.
 */
const HOST = "pintia.cn";
const PHASES = ["dns", "tcp", "tls", "headers"];
const ageClass = (value) =>
  !Number.isFinite(value) || value < 0 ? "unobserved"
    : value < 1000 ? "under1s" : value < 3000 ? "1to3s" : "over3s";
const statusClass = (status) =>
  Number.isInteger(status) && status >= 200 && status <= 599
    ? `${Math.floor(status / 100)}xx` : "none";

/** Only explicit safe fields, never request/response objects or error strings. */
export function projectPublicOriginEvidence({ start, marks, finished, outcome, status }) {
  return {
    schemaVersion: 1,
    target: "pintia-public-apex",
    requestMethod: "HEAD",
    requestPath: "/",
    outcome: ["response", "timeout", "error"].includes(outcome) ? outcome : "error",
    httpStatusClass: statusClass(status),
    totalLatencyBucket: ageClass(finished - start),
    milestones: PHASES.map((phase) => ({
      phase,
      observed: Number.isFinite(marks[phase]),
      latencyBucket: Number.isFinite(marks[phase])
        ? ageClass(marks[phase] - start) : "unobserved",
    })),
  };
}

/**
 * Exactly one HTTPS HEAD / against the static public apex. Fresh TCP socket
 * (agent:false), system TLS verification, no redirects, no cookies or credentials.
 * The end-to-end deadline applies even if DNS never resolves or TLS never starts.
 */
export async function probePintiaOrigin({
  transport = https.request,
  clock = () => Date.now(),
  timeoutMs = 6000,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new Error("PHASE13_ORIGIN_PROBE_BUDGET_INVALID");
  }
  const start = clock();
  const marks = {};
  return await new Promise((resolve) => {
    let settled = false;
    let request;
    let timeoutHandle;
    const record = (phase) => { if (marks[phase] === undefined) marks[phase] = clock(); };
    const done = (outcome, status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(projectPublicOriginEvidence({
        start, marks, finished: clock(), outcome, status,
      }));
    };
    try {
      request = transport({
        protocol: "https:", hostname: HOST, port: 443, method: "HEAD", path: "/",
        agent: false, rejectUnauthorized: true, headers: { Accept: "*/*" },
      });
      request.once("socket", (socket) => {
        socket.once("lookup", (error) => { if (!error) record("dns"); });
        socket.once("connect", () => record("tcp"));
        socket.once("secureConnect", () => record("tls"));
      });
      request.once("response", (response) => {
        record("headers");
        const status = response.statusCode;
        response.resume();
        done("response", status);
      });
      // Errors are deliberately not logged (may include sensitive paths).
      request.once("error", () => done("error", null));
      timeoutHandle = setTimeout(() => {
        done("timeout", null);
        request.destroy();
      }, timeoutMs);
      request.end();
    } catch {
      done("error", null);
      request?.destroy();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const evidence = await probePintiaOrigin();
    console.info("PHASE13_INDEPENDENT_ORIGIN_NETWORK_DIAG " + JSON.stringify(evidence));
  } catch {
    // An auxiliary diagnostic must never change the existing live-site
    // acceptance failure authority, even when its own setup is unavailable.
    console.info("PHASE13_INDEPENDENT_ORIGIN_NETWORK_DIAG " + JSON.stringify({
      schemaVersion: 1, target: "pintia-public-apex", outcome: "error",
    }));
  }
}
