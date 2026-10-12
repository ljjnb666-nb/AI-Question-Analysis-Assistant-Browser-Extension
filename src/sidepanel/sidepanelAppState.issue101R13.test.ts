import { describe, expect, it, vi } from "vitest";
import { createCandidateWorkspaceRuntime } from "@/content/candidateWorkspaceRuntime";
import { userFeedback } from "@/shared/ui/userFeedback";
import { viewportDetectionSnapshotFeedback } from "./viewportDetectionFeedback.rcPilot03a";
import { initialSidePanelAppState, sidePanelAppReducer } from "./sidepanelAppState";

const url = "https://quiz.example/exam";
const origin = { tabId: 17, url };
const first = "18aabcde-0ee2-4e98-8e12-48fdce879012";
const second = "18aabcde-0ee2-4e98-8e12-48fdce879013";
type State = typeof initialSidePanelAppState;

function runtime() {
  return createCandidateWorkspaceRuntime({
    url: () => url, send: vi.fn(), runtimeInstanceId: "r13-workspace", runtimeGeneration: 1,
  });
}
function hydrate(state: State, r: ReturnType<typeof runtime>, target = origin) {
  return sidePanelAppReducer(state, {
    type: "hydrateWorkspace", status: "ready", snapshot: r.snapshot(url).snapshot!, origin: target,
  });
}
function show(state: State, value: ReturnType<typeof viewportDetectionSnapshotFeedback>) {
  return sidePanelAppReducer(state, { type: "fillFeedback", updater: value });
}
function success(r: ReturnType<typeof runtime>, id: string, count: number) {
  r.beginDetection("viewport", id);
  r.observe({ type: "AUTO_DETECT_RESULT_READY",
    candidates: Array.from({ length: count }, (_, i) => ({
      block: { id: `question-${i}`, previewText: `Question ${i}` },
      selected: false, status: "idle",
    })) });
  return viewportDetectionSnapshotFeedback("zh", origin, r.snapshot(url), id);
}

describe("Issue #101 R13 verified viewport feedback generation lease", () => {
  it("attaches UUID to real completed candidates and accepts feedback for the current completion", () => {
    const r = runtime();
    const value = success(r, first, 1);
    expect(value.code).toBe("VIEWPORT_DETECT_CANDIDATES");
    expect(value.viewportRequestId).toBe(first);
    const state = hydrate(initialSidePanelAppState, r);
    expect(state.viewportObservedRequestId).toBe(first);
    expect(show(state, value).fillFeedback).toEqual(value);
  });

  it("carries UUID for completed empty results without claiming unknown or failed", () => {
    const r = runtime();
    const value = success(r, first, 0);
    expect(value.code).toBe("VIEWPORT_DETECT_EMPTY");
    expect(value.viewportRequestId).toBe(first);
    expect(show(hydrate(initialSidePanelAppState, r), value).fillFeedback).toEqual(value);
  });

  it("rejects a stale success banner after a newer generation began detecting", () => {
    const r = runtime();
    const old = success(r, first, 1);
    const completed = hydrate(initialSidePanelAppState, r);
    r.beginDetection("viewport", second);
    const current = hydrate(completed, r);
    expect(current.viewportObservedRequestId).toBe(second);
    expect(current.detectionPhase).toBe("detecting");
    expect(show(current, old)).toBe(current);
  });

  it("rejects an older same-UUID success after a content-owned failure rollback", () => {
    const r = runtime();
    const previous = success(r, first, 1);
    expect(r.failViewportDetection(first)).toBe(true);
    const failed = hydrate(initialSidePanelAppState, r);
    expect(failed.viewportObservedRequestId).toBe(first);
    expect(failed.detectionPhase).toBe("failed");
    expect(show(failed, previous)).toBe(failed);
  });

  it("rejects stale verified failure after another UUID already completed", () => {
    const r = runtime();
    r.beginDetection("viewport", first);
    r.failViewportDetection(first);
    const oldFailure = viewportDetectionSnapshotFeedback("zh", origin, r.snapshot(url), first);
    expect(oldFailure.code).toBe("VIEWPORT_DETECT_FAILED_CONFIRMED");
    expect(oldFailure.viewportRequestId).toBe(first);
    r.beginDetection("viewport", second);
    r.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    const current = hydrate(initialSidePanelAppState, r);
    expect(current.viewportObservedRequestId).toBe(second);
    expect(show(current, oldFailure)).toBe(current);
  });

  it("does not overrule security messages or invent authority for mismatched origins", () => {
    const r = runtime();
    const value = success(r, first, 1);
    const invalid = hydrate(initialSidePanelAppState, r, { tabId: 17, url: url + "?else" });
    expect(invalid.viewportObservedRequestId).toBeUndefined();
    expect(show(invalid, value).fillFeedback).toEqual(value);
    const current = hydrate(initialSidePanelAppState, r);
    const auth = userFeedback("error", "登录状态异常", { code: "AUTHORITY_LOST" });
    expect(show(current, auth).fillFeedback).toEqual(auth);
  });
});
