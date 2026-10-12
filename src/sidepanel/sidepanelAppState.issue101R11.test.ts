import { describe, expect, it, vi } from "vitest";
import { createCandidateWorkspaceRuntime } from "@/content/candidateWorkspaceRuntime";
import { userFeedback } from "@/shared/ui/userFeedback";
import { initialSidePanelAppState, sidePanelAppReducer } from "./sidepanelAppState";

const url = "https://quiz.example/exam";
const origin = { tabId: 9, url };
const firstId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
const secondId = "18aabcde-0ee2-4e98-8e12-48fdce879013";

function makeRuntime() {
  return createCandidateWorkspaceRuntime({
    url: () => url, send: vi.fn(), runtimeInstanceId: "r11-runtime", runtimeGeneration: 1,
  });
}
type State = typeof initialSidePanelAppState;
function hydrate(state: State, r: ReturnType<typeof makeRuntime>, status: "ready" | "syncing" = "ready") {
  return sidePanelAppReducer(state, { type: "hydrateWorkspace", status,
    snapshot: status === "ready" ? r.snapshot(url).snapshot! : undefined, origin });
}
const timeout = (requestId?: string) => userFeedback("warning", "当前屏识别等待超时",
  { code: "VIEWPORT_DETECT_TIMEOUT", viewportRequestId: requestId });
const feedback = (state: State, value: ReturnType<typeof userFeedback>) =>
  sidePanelAppReducer(state, { type: "fillFeedback", updater: value });

describe("Issue #101 R11 reverse-order viewport terminal vs UI timeout", () => {
  it("does not resurrect timeout if verified matching completed state arrived first", () => {
    const r = makeRuntime();
    r.beginDetection("viewport", firstId);
    r.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    const completed = hydrate(initialSidePanelAppState, r);
    expect(completed.viewportTerminalRequestId).toBe(firstId);
    expect(completed.detectionPhase).toBe("completed");
    expect(completed.viewportEmpty).toBe(true);
    expect(feedback(completed, timeout(firstId))).toBe(completed);
    expect(completed.fillFeedback).toBeNull();
  });

  it("does not replace a matching verified failed terminal with late timeout or call it 0 questions", () => {
    const r = makeRuntime();
    r.beginDetection("viewport", firstId);
    expect(r.failViewportDetection(firstId)).toBe(true);
    const failed = hydrate(initialSidePanelAppState, r);
    expect(failed.detectionPhase).toBe("failed");
    expect(failed.viewportEmpty).toBe(false);
    expect(feedback(failed, timeout(firstId))).toBe(failed);
  });

  it("still shows a timeout when content is genuinely detecting, without canceling work", () => {
    const r = makeRuntime();
    r.beginDetection("viewport", firstId);
    const detecting = hydrate(initialSidePanelAppState, r);
    expect(detecting.viewportTerminalRequestId).toBeUndefined();
    const timedOut = feedback(detecting, timeout(firstId));
    expect(timedOut.fillFeedback?.code).toBe("VIEWPORT_DETECT_TIMEOUT");
    expect(timedOut.isDetecting).toBe(true);
  });

  it("never suppresses another UUID or untagged timeout from an earlier surface", () => {
    const r = makeRuntime();
    r.beginDetection("viewport", secondId);
    r.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    const current = hydrate(initialSidePanelAppState, r);
    for (const id of [firstId, undefined]) {
      const newer = feedback(current, timeout(id));
      expect(newer.fillFeedback).toEqual(timeout(id));
    }
  });

  it("drops terminal identity on new detecting generation and on unavailable hydration", () => {
    const r = makeRuntime();
    r.beginDetection("viewport", firstId);
    r.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    const complete = hydrate(initialSidePanelAppState, r);
    r.beginDetection("viewport", secondId);
    const running = hydrate(complete, r);
    expect(running.viewportTerminalRequestId).toBeUndefined();
    expect(feedback(running, timeout(firstId)).fillFeedback?.code).toBe("VIEWPORT_DETECT_TIMEOUT");
    const unready = hydrate(complete, r, "syncing");
    expect(unready.viewportTerminalRequestId).toBeUndefined();
    expect(feedback(unready, timeout(firstId)).fillFeedback?.code).toBe("VIEWPORT_DETECT_TIMEOUT");
  });

  it("preserves unrelated security feedback and allows a real result notice", () => {
    const r = makeRuntime();
    r.beginDetection("viewport", firstId);
    r.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    const done = hydrate(initialSidePanelAppState, r);
    const security = userFeedback("error", "登录需要重新验证", { code: "AUTHORITY_LOST" });
    expect(feedback(done, security).fillFeedback).toEqual(security);
    const actual = userFeedback("success", "已识别到 1 道题", { code: "VIEWPORT_DETECT_CANDIDATES" });
    expect(feedback(done, actual).fillFeedback).toEqual(actual);
  });

  it("does not grant terminal authority to a snapshot from a mismatching page origin", () => {
    const r = makeRuntime();
    r.beginDetection("viewport", firstId);
    r.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    const remote = sidePanelAppReducer(initialSidePanelAppState, {
      type: "hydrateWorkspace", status: "ready", snapshot: r.snapshot(url).snapshot!,
      origin: { tabId: origin.tabId, url: "https://quiz.example/elsewhere" },
    });
    expect(remote.viewportTerminalRequestId).toBeUndefined();
    expect(feedback(remote, timeout(firstId)).fillFeedback?.code).toBe("VIEWPORT_DETECT_TIMEOUT");
  });
});
