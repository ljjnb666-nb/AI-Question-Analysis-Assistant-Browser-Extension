import { describe, expect, it, vi } from "vitest";
import { createCandidateWorkspaceRuntime } from "@/content/candidateWorkspaceRuntime";
import { userFeedback } from "@/shared/ui/userFeedback";
import { initialSidePanelAppState, sidePanelAppReducer } from "./sidepanelAppState";

const url = "https://quiz.example/exam";
const origin = { tabId: 7, url };
const firstId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
const nextId = "18aabcde-0ee2-4e98-8e12-48fdce879013";

function runtime() {
  return createCandidateWorkspaceRuntime({ url: () => url, send: vi.fn(),
    runtimeInstanceId: "feedback-r10", runtimeGeneration: 1 });
}
function hydrate(state: typeof initialSidePanelAppState, r: ReturnType<typeof runtime>) {
  return sidePanelAppReducer(state, { type: "hydrateWorkspace", status: "ready",
    snapshot: r.snapshot(url).snapshot!, origin });
}

describe("Issue #101 R10 exact-UUID timeout feedback reconciliation", () => {
  it("retains a UI timeout while its content run is still detecting, then clears it only on verified completion", () => {
    const r = runtime();
    r.beginDetection("viewport", firstId);
    let state = { ...initialSidePanelAppState,
      fillFeedback: userFeedback("warning", "等待当前屏识别结果超时",
        { code: "VIEWPORT_DETECT_TIMEOUT", viewportRequestId: firstId }) };
    state = hydrate(state, r);
    expect(state.fillFeedback?.code).toBe("VIEWPORT_DETECT_TIMEOUT");
    expect(state.isDetecting).toBe(true);
    r.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    state = hydrate(state, r);
    expect(state.fillFeedback).toBeNull();
    expect(state.detectionPhase).toBe("completed");
    expect(state.viewportEmpty).toBe(true);
  });

  it("a matching failed terminal supersedes timeout without pretending it completed with zero questions", () => {
    const r = runtime();
    r.beginDetection("viewport", firstId);
    r.failViewportDetection(firstId);
    const state = hydrate({ ...initialSidePanelAppState,
      fillFeedback: userFeedback("warning", "等待超时",
        { code: "VIEWPORT_DETECT_TIMEOUT", viewportRequestId: firstId }) }, r);
    expect(state.detectionPhase).toBe("failed");
    expect(state.viewportEmpty).toBe(false);
    expect(state.fillFeedback).toBeNull();
    expect(state.candidates).toEqual([]);
  });

  it("never retires a timeout using another generation's completion or an untagged timeout", () => {
    const r = runtime();
    r.beginDetection("viewport", nextId);
    r.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    for (const requestId of [firstId, undefined]) {
      const feedback = userFeedback("warning", "等待超时",
        { code: "VIEWPORT_DETECT_TIMEOUT", viewportRequestId: requestId });
      expect(hydrate({ ...initialSidePanelAppState, fillFeedback: feedback }, r).fillFeedback)
        .toEqual(feedback);
    }
  });

  it("a new detecting or failed run removes an older candidate-count success banner", () => {
    const r = runtime();
    const previous = userFeedback("success", "已识别到 3 道题", { code: "VIEWPORT_DETECT_CANDIDATES" });
    r.beginDetection("viewport", nextId);
    const during = hydrate({ ...initialSidePanelAppState, fillFeedback: previous }, r);
    expect(during.fillFeedback).toBeNull();
    r.failViewportDetection(nextId);
    const after = hydrate({ ...initialSidePanelAppState, fillFeedback: previous }, r);
    expect(after.detectionPhase).toBe("failed");
    expect(after.fillFeedback).toBeNull();
  });

  it("preserves unrelated security feedback and legitimate completed feedback", () => {
    const r = runtime();
    r.beginDetection("viewport", firstId);
    r.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    const auth = userFeedback("warning", "登录状态失效", { code: "AUTHORITY_LOST" });
    expect(hydrate({ ...initialSidePanelAppState, fillFeedback: auth }, r).fillFeedback).toEqual(auth);
    const completed = userFeedback("success", "已识别到 1 道题", { code: "VIEWPORT_DETECT_CANDIDATES" });
    expect(hydrate({ ...initialSidePanelAppState, fillFeedback: completed }, r).fillFeedback).toEqual(completed);
  });
});
