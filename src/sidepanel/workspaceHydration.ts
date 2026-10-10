import type { CandidateOrigin, CandidateWorkspaceSnapshot } from "@/shared/types";

export type WorkspaceHydrationStatus = "idle" | "syncing" | "ready" | "runtime_unavailable";

/** Validate the versioned transport boundary before any domain projection. */
export function isWorkspaceSnapshot(value: unknown): value is CandidateWorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as CandidateWorkspaceSnapshot;
  const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  return s.protocolVersion === 1 && typeof s.runtimeInstanceId === "string" && s.runtimeInstanceId.length > 0
    && count(s.runtimeGeneration) && s.runtimeGeneration > 0 && count(s.routeEpoch) && count(s.seq)
    && typeof s.originUrl === "string" && /^https?:\/\//i.test(s.originUrl) && typeof s.disposed === "boolean"
    && !!s.detection && ["never_started", "detecting", "completed", "failed", "incomplete"].includes(s.detection.phase)
    && (s.detection.outcome === undefined || ["completed", "no_candidates", "refinement_empty", "failed"].includes(s.detection.outcome))
    && (s.detection.failureStage === undefined || ["scanning", "refining", "publishing"].includes(s.detection.failureStage))
    && (s.detection.diagnostics === undefined || (count(s.detection.diagnostics.observedCandidates)
      && count(s.detection.diagnostics.retainedCandidates)
      && count(s.detection.diagnostics.postprocessedCandidates)
      && count(s.detection.diagnostics.refinedCandidates)))
    && [null, "viewport", "fullpage"].includes(s.detection.mode)
    && (s.detection.requestId === undefined || typeof s.detection.requestId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.detection.requestId))
    && Array.isArray(s.candidates) && s.candidates.every((c) => c && typeof c.selected === "boolean"
      && ["idle", "loading", "success", "error"].includes(c.status) && c.block && typeof c.block.id === "string" && typeof c.block.previewText === "string")
    && !!s.autoSolve && typeof s.autoSolve.running === "boolean" && validProgress(s.autoSolve.progress, "auto")
    && !!s.fullPage && typeof s.fullPage.running === "boolean" && validProgress(s.fullPage.progress, "scan");
}

function validProgress(value: unknown, kind: "auto" | "scan"): boolean {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const keys = kind === "auto" ? ["solved", "filled", "total", "current"] : ["progress", "found", "currentStep", "totalScrollSteps"];
  return keys.every((key) => typeof record[key] === "number" && Number.isFinite(record[key]) && (record[key] as number) >= 0)
    && (kind !== "auto" || typeof record.running === "boolean");
}

type Options = {
  isAuthenticated: () => boolean;
  resolveOrigin: () => Promise<CandidateOrigin | null>;
  readOrigin: (tabId: number) => Promise<CandidateOrigin | null>;
  request: (origin: CandidateOrigin) => Promise<unknown>;
  publish: (status: WorkspaceHydrationStatus, snapshot?: CandidateWorkspaceSnapshot, origin?: CandidateOrigin) => void;
};

/** Rendering authority for ONE origin. Never reads or mutates protected owner storage. */
export function createWorkspaceHydration(options: Options) {
  let ticket = 0;
  let origin: CandidateOrigin | undefined;
  let applied: CandidateWorkspaceSnapshot | undefined;
  let observed: CandidateWorkspaceSnapshot | undefined;
  let inFlight = false;
  let buffered: Array<{ snapshot: CandidateWorkspaceSnapshot; tabId: number }> = [];
  const retiredRuntimes = new Set<string>();
  const authenticated = () => options.isAuthenticated();
  const validTicket = (t: number) => t === ticket && authenticated();
  const fail = (t: number) => {
    if (!validTicket(t)) return;
    inFlight = false;
    applied = undefined;
    buffered = [];
    options.publish("runtime_unavailable", undefined, origin);
  };
  function apply(s: CandidateWorkspaceSnapshot) {
    if (!authenticated() || !origin || s.originUrl !== origin.url || s.disposed) return;
    if (applied && (s.runtimeInstanceId !== applied.runtimeInstanceId || s.routeEpoch < applied.routeEpoch
      || s.routeEpoch === applied.routeEpoch && s.seq <= applied.seq)) return;
    applied = s;
    if (observed && observed.runtimeInstanceId !== s.runtimeInstanceId) retiredRuntimes.add(observed.runtimeInstanceId);
    observed = s;
    options.publish("ready", s, origin);
  }
  async function sync(boundTabId?: number) {
    const t = ++ticket;
    if (!authenticated()) return;
    inFlight = true;
    buffered = [];
    applied = undefined;
    const previouslyObserved = observed;
    options.publish("syncing", undefined, origin);
    try {
      const captured = boundTabId != null ? await options.readOrigin(boundTabId) : await options.resolveOrigin();
      if (!validTicket(t)) return;
      if (!captured || !/^https?:\/\//i.test(captured.url)) return fail(t);
      origin = captured;
      const before = await options.readOrigin(captured.tabId);
      if (!validTicket(t)) return;
      if (before?.url !== captured.url) return fail(t);
      // Transport can fail while the same content runtime is still publishing
      // authenticated, full-state workspace events (e.g. during an MV3 wake).
      // A thrown transport failure is equivalent to null, never an authority
      // success. Keep a confirmed origin read AFTER the request settles.
      let response: unknown;
      try {
        response = await options.request(captured);
      } catch {
        response = null;
      }
      if (!validTicket(t)) return;
      const after = await options.readOrigin(captured.tabId);
      if (!validTicket(t)) return;
      if (after?.url !== captured.url) return fail(t);
      const matching = buffered.filter((e) => e.tabId === captured.tabId && e.snapshot.originUrl === captured.url);
      // Recovery is permitted only for an explicit transport loss, never for
      // malformed/negative domain replies. A single runtime must have emitted
      // a validated, main-frame, same-tab/same-URL live update DURING this sync.
      // Competing runtime instances cannot be disambiguated without a read,
      // and may not self-authorize a candidate or protected-work control.
      if (response == null && matching.length > 0) {
        // A disposed or already retired runtime event is an explicit
        // contradiction, not evidence that an active runtime is current.
        if (matching.some((e) => e.snapshot.disposed || retiredRuntimes.has(e.snapshot.runtimeInstanceId))) return fail(t);
        const instances = new Set(matching.map((e) => e.snapshot.runtimeInstanceId));
        if (instances.size !== 1) return fail(t);
        const candidate = matching.map((e) => e.snapshot)
          .sort((a, b) => b.routeEpoch - a.routeEpoch || b.seq - a.seq)[0]!;
        if (previouslyObserved?.originUrl === captured.url) {
          if (previouslyObserved.runtimeInstanceId !== candidate.runtimeInstanceId
            && candidate.runtimeGeneration <= previouslyObserved.runtimeGeneration) return fail(t);
          if (previouslyObserved.runtimeInstanceId === candidate.runtimeInstanceId
            && (candidate.routeEpoch < previouslyObserved.routeEpoch
              || candidate.routeEpoch === previouslyObserved.routeEpoch && candidate.seq <= previouslyObserved.seq)) return fail(t);
        }
        // During buffering, observe() has already advanced its high-water
        // pointer to this candidate. Explicitly retire the previous runtime
        // so its delayed events cannot trigger a new hydration/replay later.
        if (previouslyObserved?.originUrl === captured.url
          && previouslyObserved.runtimeInstanceId !== candidate.runtimeInstanceId) {
          retiredRuntimes.add(previouslyObserved.runtimeInstanceId);
        }
        inFlight = false;
        buffered = [];
        apply(candidate);
        return;
      }
      const payload = response as { ok?: boolean; snapshot?: unknown } | null;
      if (!payload?.ok || !isWorkspaceSnapshot(payload.snapshot)
        || payload.snapshot.originUrl !== captured.url || payload.snapshot.disposed
        || retiredRuntimes.has(payload.snapshot.runtimeInstanceId)) return fail(t);
      const s = payload.snapshot;
      // A retry/navigation read also shares the previously observed high-water
      // mark. Clearing the opening buffer must never revive an older same-runtime tuple.
      if (observed?.runtimeInstanceId === s.runtimeInstanceId && observed.originUrl === captured.url) {
        matching.push({ snapshot: observed, tabId: captured.tabId });
      }
      // A different instance observed during the read needs another authority read,
      // never an arbitrary event/snapshot choice. Retire the stale response instance.
      if (matching.some((e) => e.snapshot.runtimeInstanceId !== s.runtimeInstanceId
        && e.snapshot.runtimeGeneration >= s.runtimeGeneration && !retiredRuntimes.has(e.snapshot.runtimeInstanceId))) {
        retiredRuntimes.add(s.runtimeInstanceId);
        void sync(captured.tabId);
        return;
      }
      inFlight = false;
      buffered = [];
      // Full-state events permit retaining only the newest tuple while the read awaits.
      const newest = matching.filter((e) => e.snapshot.runtimeInstanceId === s.runtimeInstanceId)
        .map((e) => e.snapshot).concat(s)
        .sort((a, b) => b.routeEpoch - a.routeEpoch || b.seq - a.seq)[0]!;
      if (newest.disposed) return fail(t);
      apply(newest);
    } catch { fail(t); }
  }
  return {
    sync: () => sync(origin?.tabId),
    invalidate() {
      ++ticket;
      inFlight = false;
      origin = undefined;
      applied = undefined;
      observed = undefined;
      buffered = [];
      retiredRuntimes.clear();
      options.publish("idle");
    },
    /** Tab navigation is a new captured origin, not permission to use another tab. */
    navigation(tabId: number) {
      if (origin?.tabId !== tabId || !authenticated()) return;
      void sync(tabId);
    },
    observe(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
      if (!authenticated() || message.type !== "CANDIDATE_WORKSPACE_UPDATED" || !isWorkspaceSnapshot(message.snapshot)) return;
      const s = message.snapshot;
      const tabId = sender.tab?.id;
      if (tabId == null || sender.frameId != null && sender.frameId !== 0 || sender.tab?.url !== s.originUrl
        || retiredRuntimes.has(s.runtimeInstanceId)) return;
      if (origin && origin.tabId !== tabId) return;
      if (applied && s.runtimeInstanceId !== applied.runtimeInstanceId && s.runtimeGeneration < applied.runtimeGeneration) return;
      if (observed?.runtimeInstanceId === s.runtimeInstanceId && (s.routeEpoch < observed.routeEpoch
        || s.routeEpoch === observed.routeEpoch && s.seq <= observed.seq)) return;
      if (origin) observed = s;
      if (origin && origin.url !== s.originUrl) {
        if (applied && s.runtimeInstanceId === applied.runtimeInstanceId && s.routeEpoch <= applied.routeEpoch) return;
        void sync(tabId);
        return;
      }
      if (inFlight) {
        // Bounded: each event includes the entire latest projection, not a delta log.
        const previous = buffered.find((e) => e.tabId === tabId && e.snapshot.runtimeInstanceId === s.runtimeInstanceId);
        if (previous && (s.routeEpoch < previous.snapshot.routeEpoch || s.routeEpoch === previous.snapshot.routeEpoch && s.seq <= previous.snapshot.seq)) return;
        buffered = buffered.filter((e) => e !== previous);
        buffered.push({ snapshot: s, tabId });
        if (buffered.length > 32) buffered.shift();
        return;
      }
      if (!applied) return; // Unavailable never unlocks itself from an unsolicited event.
      if (s.runtimeInstanceId !== applied.runtimeInstanceId || s.disposed) {
        retiredRuntimes.add(applied.runtimeInstanceId);
        void sync(tabId);
        return;
      }
      apply(s);
    },
  };
}
