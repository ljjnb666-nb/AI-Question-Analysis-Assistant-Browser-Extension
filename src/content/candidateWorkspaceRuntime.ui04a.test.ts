import { describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { createCandidateWorkspaceRuntime, projectCandidateSnapshots } from "./candidateWorkspaceRuntime";
import { createContentDetectionBridge } from "./contentDetectionBridge";
import { createContentRuntimeMessageListener } from "./contentRuntimeMessages";

export const question = (): QuestionBlock => ({ id: "q1", previewText: "Question A. One B. Two", bbox: { x: 0, y: 0, width: 100, height: 40 }, hasImage: false, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom",
  runtimeQuestionHandle: "handle1", identity: { stableId: "stable1", contentFingerprint: "fp1", identityVersion: 1, strategy: "content-only", signals: { nativeId: false, content: true, options: true, media: false, structure: false } } });

describe("UI-04A content snapshot authority", () => {
  function setup() {
    let url = "https://quiz.example/exam";
    const send = vi.fn();
    const runtime = createCandidateWorkspaceRuntime({ url: () => url, send, runtimeInstanceId: "runtime1", runtimeGeneration: 1 });
    return { runtime, send, read: () => runtime.snapshot(url).snapshot!, route: () => { url = "https://quiz.example/next"; runtime.resetRoute(); } };
  }
  it("UI04A-02 completed-empty is distinct from never_started", () => {
    const { runtime, read } = setup();
    expect(read().detection.phase).toBe("never_started");
    runtime.beginDetection("viewport");
    expect(read().detection.phase).toBe("detecting");
    runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    expect(read().detection.phase).toBe("completed");
    expect(read().candidates).toEqual([]);
  });
  it("UI04A-15 explicitly normalizes pending and unknown statuses without fabricating results", () => {
    for (const status of ["pending", "future", "idle"]) expect(projectCandidateSnapshots([question()], new Map([["q1", { status, selected: true }]]))[0]).toMatchObject({ status: "idle", selected: true });
    for (const status of ["loading", "success", "error"]) expect(projectCandidateSnapshots([question()], new Map([["q1", { status, selected: false }]]))[0]?.status).toBe(status);
    expect(projectCandidateSnapshots([question()], new Map())[0]).not.toHaveProperty("result");
  });
  it("UI04A-16/17/18 snapshot request has no selection/workflow/owner side effects", () => {
    const { runtime, read, send } = setup();
    runtime.beginDetection("viewport");
    runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: projectCandidateSnapshots([question()], new Map([["q1", { status: "pending", selected: true }]])) });
    const before = read();
    send.mockClear();
    const workflow = vi.fn();
    const listener = createContentRuntimeMessageListener({ getWorkspaceSnapshot: runtime.snapshot, isRuntimeCurrent: () => true,
      handleAutoDetect: workflow, handleFullPageDetect: workflow, startAutoSolveAll: workflow,
      // The snapshot branch must return before any other option is used.
    } as unknown as Parameters<typeof createContentRuntimeMessageListener>[0]);
    const response = vi.fn();
    expect(listener({ type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl: before.originUrl }, {}, response)).toBe(false);
    expect(response).toHaveBeenCalledWith({ ok: true, snapshot: before });
    expect(read()).toEqual(before);
    expect(send).not.toHaveBeenCalled();
    expect(workflow).not.toHaveBeenCalled();
    expect(runtime.snapshot("https://other.example").ok).toBe(false);
  });
  it("UI04A-SEQ content seq advances for candidate/selection/detection/run/completion/reset transitions", () => {
    const { runtime, read, route, send } = setup();
    const advance = (action: () => void) => { const seq = read().seq; action(); expect(read().seq).toBeGreaterThan(seq); };
    advance(() => runtime.beginDetection("viewport"));
    advance(() => runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: projectCandidateSnapshots([question()], new Map()) }));
    advance(() => runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: projectCandidateSnapshots([question()], new Map([["q1", { status: "pending", selected: true }]])) }));
    advance(() => runtime.setAutoSolveRunning(true));
    advance(() => runtime.observe({ type: "AUTO_SOLVE_PROGRESS", running: true, solved: 0, filled: 0, current: 1, total: 2, statusCode: "PARSING", currentQuestionId: "q1", currentBlock: question() }));
    expect(read().autoSolve.progress?.currentQuestionId).toBe("q1");
    advance(() => runtime.observe({ type: "AUTO_SOLVE_DONE", ok: true }));
    expect(read().autoSolve).toEqual({ running: false, progress: null });
    advance(() => runtime.resetDetection());
    advance(route);
    expect(read().routeEpoch).toBe(1);
    const seq = read().seq;
    runtime.dispose();
    expect(send.mock.calls[send.mock.calls.length - 1]?.[0].snapshot.seq).toBeGreaterThan(seq);
  });
  it("RC03B-R9 keeps failed scan distinct from completed-empty and fences canceled outcomes", () => {
    const { runtime, read } = setup();
    runtime.beginDetection("fullpage");
    runtime.observe({ type: "FULL_PAGE_DETECT_DONE", outcome: "failed", failureStage: "refining",
      diagnostics: { observedCandidates: 3, retainedCandidates: 2, postprocessedCandidates: 1, refinedCandidates: 0 }, candidates: [], totalFound: 0 });
    expect(read().detection).toMatchObject({ phase: "failed", mode: "fullpage", outcome: "failed", failureStage: "refining" });
    expect(read().detection.diagnostics?.postprocessedCandidates).toBe(1);
    runtime.beginDetection("fullpage");
    runtime.observe({ type: "FULL_PAGE_DETECT_DONE", outcome: "refinement_empty", candidates: [], totalFound: 0 });
    expect(read().detection.phase).toBe("incomplete");
    runtime.beginDetection("fullpage");
    runtime.cancelFullPage();
    const canceled = read();
    expect(runtime.observe({ type: "FULL_PAGE_DETECT_DONE", outcome: "failed", candidates: [] })).toBe(false);
    expect(read()).toEqual(canceled);
  });

  it("UI04A-SCAN cancellation/completion fence old progress and clear ephemeral counters", () => {
    const { runtime, read } = setup();
    runtime.beginDetection("fullpage");
    runtime.observe({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 25, found: 1, currentStep: 1, totalScrollSteps: 4 });
    expect(read().fullPage.progress?.found).toBe(1);
    runtime.cancelFullPage();
    const canceled = read();
    expect(runtime.observe({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 50 })).toBe(false);
    expect(runtime.observe({ type: "FULL_PAGE_DETECT_DONE", candidates: [question()] })).toBe(false);
    expect(read()).toEqual(canceled);
    runtime.beginDetection("fullpage");
    runtime.observe({ type: "FULL_PAGE_DETECT_DONE", candidates: [] });
    expect(read().fullPage).toEqual({ running: false, progress: null });
    expect(read().detection).toEqual({ phase: "completed", mode: "fullpage" });
    expect(runtime.observe({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 90 })).toBe(false);
  });
  it("UI04A-RESET route/runtime/new-run reset progress; safety terminal persists without success toast", () => {
    const { runtime, read, route } = setup();
    runtime.setAutoSolveRunning(true);
    runtime.observe({ type: "AUTO_SOLVE_PROGRESS", running: true, statusCode: "FILL_STOPPED_SAFETY", solved: 1, filled: 0, current: 1, total: 2 });
    runtime.observe({ type: "AUTO_SOLVE_DONE", ok: false });
    expect(read().autoSolve.running).toBe(false);
    expect(read().autoSolve.progress?.statusCode).toBe("FILL_STOPPED_SAFETY");
    runtime.setAutoSolveRunning(true);
    expect(read().autoSolve.progress).toBeNull();
    route();
    expect(read().autoSolve).toEqual({ running: false, progress: null });
    expect(read().detection.phase).toBe("never_started");
    const url = read().originUrl;
    runtime.dispose();
    expect(runtime.snapshot(url).ok).toBe(false);
  });
});


it("UI04A scan generation fences an old scan completion after cancellation and a replacement scan", async () => {
  let release!: (blocks: QuestionBlock[]) => void;
  const pending = new Promise<QuestionBlock[]>((resolve) => { release = resolve; });
  const runtime = createCandidateWorkspaceRuntime({ url: () => location.href, send: vi.fn() });
  runtime.beginDetection("fullpage");
  const setActiveCandidates = vi.fn();
  const cancelFullPageScan = vi.fn();
  const send = vi.fn();
  const bridge = createContentDetectionBridge({
    candidateStatusMap: new Map(), isRuntimeCurrent: () => true,
    workspaceRouteEpoch: () => runtime.metadata().routeEpoch,
    workspaceDetectionGeneration: runtime.detectionGeneration,
    isFullPageScanRunning: () => false, cancelFullPageScan,
    logEvent: vi.fn(), destroyHighlightLayer: vi.fn(), stopSpaWatch: vi.fn(),
    refreshLayoutResizeObservation: vi.fn(), safeRuntimeSendMessage: send,
    detectCandidatesFullPage: () => pending, setActiveCandidates,
    // The superseded scan must return before any refinement/highlight dependency.
  } as unknown as Parameters<typeof createContentDetectionBridge>[0]);
  const oldScan = bridge.handleFullPageDetect();
  runtime.cancelFullPage();
  runtime.beginDetection("fullpage");
  const before = runtime.snapshot(location.href).snapshot;
  release([question()]);
  await oldScan;
  expect(setActiveCandidates).not.toHaveBeenCalled();
  expect(cancelFullPageScan).not.toHaveBeenCalled();
  expect(send.mock.calls.map(([message]) => message.type)).not.toContain("FULL_PAGE_DETECT_DONE");
  expect(runtime.snapshot(location.href).snapshot).toEqual(before);
});


it("UI04A selection updates the latest live candidate IDs without replaying stale detection blocks", () => {
  const latest = { ...question(), id: "latest" };
  const statuses = new Map([[latest.id, { status: "pending", selected: false }]]);
  const runtime = createCandidateWorkspaceRuntime({ url: () => location.href, send: vi.fn() });
  runtime.beginDetection("viewport");
  runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: projectCandidateSnapshots([latest], statuses) });
  const before = runtime.metadata().seq;
  const listener = createContentRuntimeMessageListener({
    candidateStatusMap: statuses,
    getActiveCandidates: () => [question()], getActiveHighlightBlocks: () => [], getHighlightLayer: () => null,
    notifySidePanel: vi.fn(() => { throw new Error("must not replay stale blocks"); }),
    notifySelectionChanged: () => { runtime.updateSelection(statuses); },
  } as unknown as Parameters<typeof createContentRuntimeMessageListener>[0]);
  listener({ type: "UPDATE_CANDIDATE_SELECTION", blockId: latest.id, selected: true }, {}, vi.fn());
  expect(runtime.snapshot(location.href).snapshot?.candidates).toMatchObject([{ block: { id: "latest" }, selected: true, status: "idle" }]);
  expect(runtime.metadata().seq).toBeGreaterThan(before);
});
