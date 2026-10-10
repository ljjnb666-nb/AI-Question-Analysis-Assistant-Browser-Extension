import type { AutoSolveProgressMsg, CandidateSnapshot, CandidateWorkspaceSnapshot, FullPageDetectProgressMsg, FullPageDetectDoneMsg, ParseStatus, QuestionBlock } from "@/shared/types";
import { sanitizeQuestionBlockForRuntimeMessage, sanitizeQuestionBlockForSerialization } from "@/shared/utils/mediaSerialization";

export function normalizeCandidateStatus(status: string | undefined): ParseStatus {
  switch (status) {
    case "loading": case "success": case "error": return status;
    default: return "idle";
  }
}

/** One projection for live detection and opening snapshots. Never includes panel results. */
export function projectCandidateSnapshots(blocks: QuestionBlock[], statuses: Map<string, { status: string; selected: boolean }>): CandidateSnapshot[] {
  return blocks.map((block) => ({
    block: sanitizeQuestionBlockForRuntimeMessage(block),
    selected: statuses.get(block.id)?.selected === true,
    status: normalizeCandidateStatus(statuses.get(block.id)?.status),
  }));
}

const documentGenerationKey = "__quizSolverWorkspaceGeneration";
function nextDocumentGeneration(): number {
  const root = globalThis as typeof globalThis & { [documentGenerationKey]?: number };
  root[documentGenerationKey] = (root[documentGenerationKey] ?? 0) + 1;
  return root[documentGenerationKey];
}

/** Latest content-owned projection only. No storage, history, provider result or owner access. */
export function createCandidateWorkspaceRuntime(options: {
  url: () => string;
  send: (message: unknown) => void;
  runtimeInstanceId?: string;
  runtimeGeneration?: number;
}) {
  let detectionGeneration = 0;
  let state: CandidateWorkspaceSnapshot = {
    protocolVersion: 1,
    runtimeInstanceId: options.runtimeInstanceId ?? crypto.randomUUID(),
    runtimeGeneration: options.runtimeGeneration ?? nextDocumentGeneration(),
    routeEpoch: 0, seq: 0, originUrl: options.url(),
    detection: { phase: "never_started", mode: null }, candidates: [],
    autoSolve: { running: false, progress: null }, fullPage: { running: false, progress: null }, disposed: false,
  };
  const snapshot = () => structuredClone(state);
  const publish = () => {
    state = { ...state, seq: state.seq + 1 };
    options.send({ type: "CANDIDATE_WORKSPACE_UPDATED", snapshot: snapshot() });
  };
  function resetRoute() {
    ++detectionGeneration;
    state = { ...state, routeEpoch: state.routeEpoch + 1, originUrl: options.url(),
      detection: { phase: "never_started", mode: null }, candidates: [],
      autoSolve: { running: false, progress: null }, fullPage: { running: false, progress: null } };
    publish();
  }
  function ensureRoute() {
    if (state.originUrl !== options.url()) resetRoute();
  }
  return {
    detectionGeneration: () => detectionGeneration,
    metadata() {
      const { protocolVersion, runtimeInstanceId, runtimeGeneration, routeEpoch, seq, originUrl } = state;
      return { protocolVersion, runtimeInstanceId, runtimeGeneration, routeEpoch, seq, originUrl };
    },
    snapshot(expectedUrl: string) {
      const valid = !state.disposed && expectedUrl === state.originUrl && options.url() === state.originUrl;
      return { ok: valid, snapshot: valid ? snapshot() : undefined };
    },
    updateSelection(statuses: Map<string, { status: string; selected: boolean }>) {
      ensureRoute();
      state = { ...state, candidates: projectCandidateSnapshots(state.candidates.map((c) => c.block), statuses) };
      publish();
      return snapshot().candidates;
    },
    beginDetection(mode: "viewport" | "fullpage", requestId?: string) {
      ensureRoute();
      ++detectionGeneration;
      state = { ...state, detection: { phase: "detecting", mode, ...(requestId ? { requestId } : {}) },
        candidates: [], fullPage: { running: mode === "fullpage", progress: null } };
      publish();
    },
    /** A failed viewport run may reset ONLY its matching generation. Its
     * completion message may already have been projected before a later
     * highlight/render step throws, so even a "completed" snapshot is not
     * final until the tagged command returns success. */
    failViewportDetection(requestId: string) {
      if (state.disposed || state.originUrl !== options.url()
        || state.detection.mode !== "viewport"
        || !["detecting", "completed"].includes(state.detection.phase)
        || state.detection.requestId !== requestId) return false;
      ++detectionGeneration;
      state = { ...state, detection: { phase: "never_started", mode: null }, candidates: [] };
      publish();
      return true;
    },
    resetDetection() {
      ensureRoute();
      ++detectionGeneration;
      state = { ...state, candidates: [], detection: { phase: "never_started", mode: null }, fullPage: { running: false, progress: null } };
      publish();
    },
    resetRoute,
    setAutoSolveRunning(running: boolean) {
      ensureRoute();
      // The controller is the authority during the await before its first progress emission.
      state = { ...state, autoSolve: { running, progress: running ? null : state.autoSolve.progress?.statusCode === "FILL_STOPPED_SAFETY" ? state.autoSolve.progress : null } };
      publish();
    },
    cancelFullPage() {
      ensureRoute();
      ++detectionGeneration;
      state = { ...state, detection: { ...state.detection, phase: "never_started" }, fullPage: { running: false, progress: null } };
      publish();
    },
    /** Capture at the existing authoritative emission boundary, before sending compatibility events. */
    observe(message: Record<string, unknown>) {
      if (state.disposed) return false;
      ensureRoute();
      switch (message.type) {
        case "AUTO_DETECT_RESULT_READY":
          state = { ...state, candidates: message.candidates as CandidateSnapshot[],
            detection: { ...state.detection, phase: "completed", mode: state.detection.mode ?? "viewport" } };
          break;
        case "FULL_PAGE_DETECT_PROGRESS":
          if (!state.fullPage.running) return false;
          state = { ...state, fullPage: { running: true, progress: message as unknown as FullPageDetectProgressMsg } };
          break;
        case "FULL_PAGE_DETECT_DONE": {
          if (!state.fullPage.running) return false; // cancellation fences late completion
          const done = message as unknown as FullPageDetectDoneMsg;
          const phase = done.outcome === "failed" ? "failed"
            : ["filtered_empty", "postprocess_empty", "refinement_empty"].includes(done.outcome ?? "") ? "incomplete" : "completed";
          state = { ...state, detection: { phase, mode: "fullpage",
            ...(done.outcome ? { outcome: done.outcome } : {}),
            ...(done.failureStage ? { failureStage: done.failureStage } : {}),
            ...(done.diagnostics ? { diagnostics: done.diagnostics } : {}) },
            candidates: projectCandidateSnapshots(done.candidates ?? [], new Map()), fullPage: { running: false, progress: null } };
          break;
        }
        case "AUTO_SOLVE_PROGRESS": {
          const progress = message as unknown as AutoSolveProgressMsg;
          state = { ...state, autoSolve: { running: progress.running, progress: { ...progress, currentBlock: progress.currentBlock ? sanitizeQuestionBlockForSerialization(progress.currentBlock) : undefined } } };
          break;
        }
        case "AUTO_SOLVE_DONE":
          state = { ...state, autoSolve: { running: false, progress: state.autoSolve.progress?.statusCode === "FILL_STOPPED_SAFETY" ? state.autoSolve.progress : null } };
          break;
        default: return false;
      }
      publish();
      return true;
    },
    dispose() {
      state = { ...state, disposed: true, candidates: [], detection: { phase: "never_started", mode: null }, autoSolve: { running: false, progress: null }, fullPage: { running: false, progress: null } };
      publish();
    },
  };
}
