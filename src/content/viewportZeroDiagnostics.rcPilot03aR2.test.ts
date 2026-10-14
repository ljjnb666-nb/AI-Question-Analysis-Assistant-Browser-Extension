import { describe, expect, it, vi } from "vitest";
import { createCandidateWorkspaceRuntime } from "./candidateWorkspaceRuntime";
import { handleAutoDetect, notifySidePanel } from "./detectOrchestration";
import { isWorkspaceSnapshot } from "@/sidepanel/workspaceHydration";
import type { DomCandidateDiagnostics, QuestionBlock } from "@/shared/types";

const url = "https://example.org/quiz";
const request = "18aabcde-0ee2-4e98-8e12-48fdce879012";

function diagnostic(): DomCandidateDiagnostics {
  return { probedElements: 5, acceptedCandidates: 0,
    rejected: { geometry: 1, text: 0, controls: 0, navigation: 0, signal: 0, confidence: 0, completeness: 4, grouped: 0, fragment: 0, duplicate: 0 } };
}

describe("RC-PILOT-03A-R2 viewport numeric diagnostics", () => {
  it("uses the initial detector result as the only numeric evidence source", () => {
    const send = vi.fn();
    const workspace = createCandidateWorkspaceRuntime({ url: () => url, send, runtimeInstanceId: "diag-r2", runtimeGeneration: 1 });
    workspace.beginDetection("viewport", request);
    const statuses = new Map<string, { status: string; selected: boolean }>();
    const detector = vi.fn((values?: DomCandidateDiagnostics) => {
      expect(values).toBeDefined();
      Object.assign(values!, diagnostic());
      return [] as QuestionBlock[];
    });
    const notify = vi.fn((candidates: QuestionBlock[], diag?: DomCandidateDiagnostics) =>
      notifySidePanel(candidates, { candidateStatusMap: statuses,
        safeRuntimeSendMessage: (message) => { workspace.observe(message as Record<string, unknown>); } }, diag));
    const layerFactory = vi.fn(() => ({ setBlocks: vi.fn() }));
    const state = handleAutoDetect({
      candidateStatusMap: statuses,
      logEvent: vi.fn(), destroyHighlightLayer: vi.fn(), stopSpaWatch: vi.fn(),
      detectCandidatesInViewport: detector, notifySidePanel: notify,
      createHighlightLayer: layerFactory, watchForPageChanges: vi.fn(() => vi.fn()),
    });
    expect(state.activeCandidates).toEqual([]);
    expect(layerFactory).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]?.[1]).toEqual(diagnostic());
    const snapshot = workspace.snapshot(url).snapshot!;
    expect(isWorkspaceSnapshot(snapshot)).toBe(true);
    expect(snapshot.detection).toMatchObject({ phase: "completed", mode: "viewport", requestId: request,
      diagnostics: { observedCandidates: 0, retainedCandidates: 0,
        postprocessedCandidates: 0, refinedCandidates: 0,
        domDiagnostics: { probedElements: 5, rejected: { completeness: 4, geometry: 1 } } } });
    expect(snapshot.candidates).toEqual([]);
    // No raw text, URL, selector, DOM node or arbitrary rejection keys are sent.
    expect(JSON.stringify(snapshot.detection.diagnostics)).not.toContain(url);
    expect(JSON.stringify(snapshot.detection.diagnostics)).not.toContain("questionText");
  });

  it("does not carry previous DOM rejection evidence across a new run or route", () => {
    let page = url;
    const workspace = createCandidateWorkspaceRuntime({ url: () => page, send: vi.fn() });
    workspace.beginDetection("viewport", request);
    workspace.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [], domDiagnostics: diagnostic() });
    expect(workspace.snapshot(url).snapshot?.detection.diagnostics?.domDiagnostics?.probedElements).toBe(5);
    workspace.beginDetection("viewport", "18aabcde-0ee2-4e98-8e12-48fdce879013");
    workspace.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    expect(workspace.snapshot(url).snapshot?.detection.diagnostics).toBeUndefined();
    page = "https://example.org/quiz/next";
    workspace.resetRoute();
    expect(workspace.snapshot(url).ok).toBe(false);
    expect(workspace.snapshot(page).snapshot?.detection).toEqual({ phase: "never_started", mode: null });
  });

  it("invalid numeric diagnostics fail closed at the workspace validator", () => {
    const workspace = createCandidateWorkspaceRuntime({ url: () => url, send: vi.fn() });
    workspace.beginDetection("viewport", request);
    workspace.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [], domDiagnostics: diagnostic() });
    const snapshot = workspace.snapshot(url).snapshot!;
    expect(isWorkspaceSnapshot(snapshot)).toBe(true);
    const bad = structuredClone(snapshot);
    bad.detection.diagnostics!.domDiagnostics!.rejected.completeness = -1;
    expect(isWorkspaceSnapshot(bad)).toBe(false);
    const leaked = structuredClone(snapshot);
    Object.assign(leaked.detection.diagnostics!.domDiagnostics!, { rawPageText: "hidden question text" });
    expect(isWorkspaceSnapshot(leaked)).toBe(false);
  });
});
