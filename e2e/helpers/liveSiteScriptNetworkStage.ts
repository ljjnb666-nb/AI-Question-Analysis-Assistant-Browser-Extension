import { isPintiaPartyHost } from "./liveSiteDiagnostics";

/**
 * Privacy-bounded evidence for live page script delivery stages.
 * Request objects are ephemeral Map keys only; URL strings are used solely
 * to classify the host and are NEVER saved or serialized.
 *
 * "beforeHeaders" means Playwright has not observed a response for an
 * outstanding request; it cannot independently distinguish DNS, TLS,
 * CDN, browser blocking, or server-side waiting.
 */
type ScriptRequest = { url(): string; resourceType(): string };
type ScriptResponse = { request(): ScriptRequest; status(): number };
type PendingScript = { firstParty: boolean; startedMs: number; responseStatus: number | null };
const MAX_TRACKED = 64;
const MAX_COUNTER = 1_000_000;

const increment = (value: number) => Math.min(MAX_COUNTER, value + 1);
const bucket = (status: number | null): "none" | "2xx" | "3xx" | "4xx" | "5xx" | "other" => {
  if (status === null) return "none";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
};
const ageBucket = (age: number): "none" | "under5s" | "5to17s" | "over17s" => {
  if (age <= 0) return "none";
  if (age < 5_000) return "under5s";
  if (age < 17_000) return "5to17s";
  return "over17s";
};

export function createScriptNetworkStageProbe(now: () => number = () => Date.now()) {
  const pending = new Map<ScriptRequest, PendingScript>();
  let observed = 0;
  let completed = 0;
  let failed = 0;
  let untracked = 0;
  return {
    onRequest(request: ScriptRequest) {
      if (request.resourceType() !== "script" || pending.has(request)) return;
      observed = increment(observed);
      if (pending.size >= MAX_TRACKED) { untracked = increment(untracked); return; }
      let firstParty = false;
      try { firstParty = isPintiaPartyHost(new URL(request.url()).hostname); }
      catch { /* non-URL: treat as non-first-party */ }
      pending.set(request, { firstParty, startedMs: now(), responseStatus: null });
    },
    onResponse(response: ScriptResponse) {
      const item = pending.get(response.request());
      if (!item) return;
      const status = response.status();
      item.responseStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
    },
    onFinished(request: ScriptRequest) {
      if (pending.delete(request)) completed = increment(completed);
    },
    onFailed(request: ScriptRequest) {
      if (pending.delete(request)) failed = increment(failed);
    },
    snapshot() {
      const counts = {
        firstPartyBeforeHeaders: 0, firstPartyAfterHeaders: 0,
        otherBeforeHeaders: 0, otherAfterHeaders: 0,
        pending2xx: 0, pending3xx: 0, pending4xx: 0, pending5xx: 0, pendingOther: 0,
      };
      let oldest = 0;
      const time = now();
      for (const item of pending.values()) {
        const classKey = item.firstParty
          ? (item.responseStatus === null ? "firstPartyBeforeHeaders" : "firstPartyAfterHeaders")
          : (item.responseStatus === null ? "otherBeforeHeaders" : "otherAfterHeaders");
        counts[classKey] += 1;
        if (item.responseStatus !== null) {
          const statusBucket = bucket(item.responseStatus);
          if (statusBucket === "2xx") counts.pending2xx += 1;
          else if (statusBucket === "3xx") counts.pending3xx += 1;
          else if (statusBucket === "4xx") counts.pending4xx += 1;
          else if (statusBucket === "5xx") counts.pending5xx += 1;
          else counts.pendingOther += 1;
        }
        oldest = Math.max(oldest, Math.max(0, time - item.startedMs));
      }
      return {
        schemaVersion: 1,
        observedScripts: observed, completedScripts: completed,
        failedScripts: failed, untrackedScripts: untracked,
        pendingScripts: pending.size, oldestPendingAge: ageBucket(oldest),
        ...counts,
      };
    },
  };
}
