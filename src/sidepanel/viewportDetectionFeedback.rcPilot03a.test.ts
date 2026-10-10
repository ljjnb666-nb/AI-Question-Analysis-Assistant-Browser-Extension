import { describe, expect, it, vi } from "vitest";
import { createCandidateWorkspaceRuntime } from "@/content/candidateWorkspaceRuntime";
import type { CandidateWorkspaceSnapshot } from "@/shared/types";
import { viewportDetectionSnapshotFeedback } from "./viewportDetectionFeedback.rcPilot03a";

const origin = { tabId: 7, url: "https://quiz.example/exam" };

function snapshot(count = 0): { ok: boolean; snapshot?: CandidateWorkspaceSnapshot } {
  const runtime = createCandidateWorkspaceRuntime({
    url: () => origin.url,
    send: vi.fn(),
    runtimeInstanceId: "viewport-feedback-test",
    runtimeGeneration: 1,
  });
  runtime.beginDetection("viewport");
  runtime.observe({
    type: "AUTO_DETECT_RESULT_READY",
    candidates: Array.from({ length: count }, (_, i) => ({
      block: { id: `q-${i}`, previewText: `Question ${i}` },
      selected: false,
      status: "idle",
    })),
  });
  return runtime.snapshot(origin.url);
}

describe("RC-PILOT-03A current-screen verified feedback", () => {
  it("shows accurate Chinese feedback for a completed empty snapshot", () => {
    const value = viewportDetectionSnapshotFeedback("zh", origin, snapshot(0));
    expect(value.code).toBe("VIEWPORT_DETECT_EMPTY");
    expect(value.tone).toBe("warning");
    expect(value.message).toContain("未识别到可用题目");
  });

  it("shows the candidate count from a validated snapshot, not a START ACK", () => {
    const value = viewportDetectionSnapshotFeedback("zh", origin, snapshot(3));
    expect(value.code).toBe("VIEWPORT_DETECT_CANDIDATES");
    expect(value.message).toContain("3 道候选题");
  });

  it("does not treat missing or transport-rejected snapshot as success", () => {
    for (const response of [null, { ok: false }, { ok: true }]) {
      expect(viewportDetectionSnapshotFeedback("zh", origin, response).code)
        .toBe("VIEWPORT_DETECT_RESULT_UNCONFIRMED");
    }
  });

  it("rejects a wrong origin URL and a disposed runtime", () => {
    const valid = snapshot(2);
    expect(viewportDetectionSnapshotFeedback("zh", { ...origin, url: "https://quiz.example/other" }, valid).code)
      .toBe("VIEWPORT_DETECT_RESULT_UNCONFIRMED");
    expect(viewportDetectionSnapshotFeedback("zh", origin, {
      ok: true, snapshot: { ...valid.snapshot!, disposed: true },
    }).code).toBe("VIEWPORT_DETECT_RESULT_UNCONFIRMED");
  });

  it("never trusts a malformed protocol or negative runtime sequence", () => {
    const s = snapshot(4).snapshot!;
    for (const invalid of [{ ...s, protocolVersion: 2 }, { ...s, seq: -1 }]) {
      expect(viewportDetectionSnapshotFeedback("zh", origin, { ok: true, snapshot: invalid as never }).tone)
        .toBe("warning");
    }
  });

  it("does not report a completion while detection is in progress or belongs to a full scan", () => {
    const s = snapshot(1).snapshot!;
    for (const detection of [{ phase: "detecting", mode: "viewport" }, { phase: "completed", mode: "fullpage" }]) {
      expect(viewportDetectionSnapshotFeedback("zh", origin, { ok: true, snapshot: { ...s, detection } as never }).code)
        .toBe("VIEWPORT_DETECT_RESULT_UNCONFIRMED");
    }
  });

  it("refuses another click generation even when URL and candidate count look valid", () => {
    const id = "18aabcde-0ee2-4e98-8e12-48fdce879012";
    const other = "18aabcde-0ee2-4e98-8e12-48fdce879013";
    const runtime = createCandidateWorkspaceRuntime({ url: () => origin.url, send: vi.fn(),
      runtimeInstanceId: "viewport-exact-identity", runtimeGeneration: 1 });
    runtime.beginDetection("viewport", id);
    runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    const current = runtime.snapshot(origin.url);
    expect(viewportDetectionSnapshotFeedback("zh", origin, current, id).code).toBe("VIEWPORT_DETECT_EMPTY");
    expect(viewportDetectionSnapshotFeedback("zh", origin, current, other).code)
      .toBe("VIEWPORT_DETECT_RESULT_UNCONFIRMED");
    const malformed = { ...current.snapshot!, detection: { phase: "completed", mode: "viewport", requestId: "invalid" } };
    expect(viewportDetectionSnapshotFeedback("zh", origin, { ok: true, snapshot: malformed as never }, id).code)
      .toBe("VIEWPORT_DETECT_RESULT_UNCONFIRMED");
  });

  it("keeps English-language feedback readable without displaying machine status codes", () => {
    const value = viewportDetectionSnapshotFeedback("en", origin, snapshot(1));
    expect(value.message).toContain("1 candidate question");
    expect(value.message).not.toContain(value.code!);
  });
});
