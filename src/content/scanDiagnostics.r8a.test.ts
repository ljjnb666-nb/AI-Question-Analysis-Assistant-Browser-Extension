import { describe, expect, it, vi } from "vitest";
import type { DomCandidateDiagnostics, QuestionBlock } from "@/shared/types";
import { createCandidateWorkspaceRuntime } from "./candidateWorkspaceRuntime";
import { handleFullPageDetect } from "./detectOrchestration";
import { isWorkspaceSnapshot } from "@/sidepanel/workspaceHydration";

const diagnostic = (): DomCandidateDiagnostics => ({
  probedElements: 6, acceptedCandidates: 0,
  rejected: { geometry: 1, text: 0, controls: 0, navigation: 1, signal: 1, confidence: 0, completeness: 3, grouped: 0, fragment: 0, duplicate: 0 },
});

describe("R8A diagnostics preserve workspace authority and privacy", () => {
  it("R8A-06 carries numeric probe reasons through DONE to a validated workspace projection", async () => {
    const runtime = createCandidateWorkspaceRuntime({ url: () => location.href, send: vi.fn() });
    const outbound = vi.fn((m: Record<string, unknown>) => runtime.observe(m));
    runtime.beginDetection("fullpage");
    const deps = {
      isFullPageScanRunning: () => false, isRuntimeCurrent: () => true,
      cancelFullPageScan: vi.fn(), logEvent: vi.fn(), destroyHighlightLayer: vi.fn(),
      stopSpaWatch: vi.fn(), candidateStatusMap: new Map(),
      refreshLayoutResizeObservation: vi.fn(), safeRuntimeSendMessage: outbound,
      detectCandidatesFullPage: vi.fn().mockImplementation(async (progress: (p: unknown) => void) => {
        progress({ progress: 99, found: 0, currentStep: 1, totalScrollSteps: 1,
          observedCandidates: 0, retainedCandidates: 0, domDiagnostics: diagnostic() });
        return [] as QuestionBlock[];
      }),
      refineFullPageCandidatesViaManualPipeline: vi.fn().mockResolvedValue([] as QuestionBlock[]),
      resolveFullPageScrollRoot: () => window, getFullPageLayoutKey: () => "layout",
      createHighlightLayer: () => ({ setBlocks: vi.fn() }), refreshFullPageHighlightsAfterLayoutChange: vi.fn(),
      notifySidePanel: vi.fn(),
    } as unknown as Parameters<typeof handleFullPageDetect>[0];
    await handleFullPageDetect(deps);
    const snapshot = runtime.snapshot(location.href).snapshot!;
    expect(isWorkspaceSnapshot(snapshot)).toBe(true);
    expect(snapshot.detection).toMatchObject({
      phase: "completed", outcome: "no_candidates",
      diagnostics: { domDiagnostics: { probedElements: 6, rejected: { completeness: 3, navigation: 1 } } },
    });
    expect(JSON.stringify(snapshot.detection.diagnostics)).not.toContain("http");
    const done = outbound.mock.calls.map(x => x[0]).find(x => x.type === "FULL_PAGE_DETECT_DONE");
    expect(done).toBeDefined();
    expect((done?.diagnostics as { domDiagnostics: DomCandidateDiagnostics }).domDiagnostics).toEqual(diagnostic());
  });

  it("R8A-07 invalid numeric probes fail closed while valid terminal counts remain readable", () => {
    const runtime = createCandidateWorkspaceRuntime({ url: () => location.href, send: vi.fn() });
    runtime.beginDetection("fullpage");
    runtime.observe({ type: "FULL_PAGE_DETECT_DONE", candidates: [], totalFound: 0, outcome: "no_candidates",
      diagnostics: { observedCandidates: 0, retainedCandidates: 0, postprocessedCandidates: 0, refinedCandidates: 0,
        domDiagnostics: diagnostic() } });
    const good = runtime.snapshot(location.href).snapshot!;
    expect(isWorkspaceSnapshot(good)).toBe(true);
    const bad = structuredClone(good);
    bad.detection.diagnostics!.domDiagnostics!.rejected.completeness = -1;
    expect(isWorkspaceSnapshot(bad)).toBe(false);
  });

  it("R8A-08 canceled generation cannot replay new diagnostic progress or DONE into replacement workspace", () => {
    const runtime = createCandidateWorkspaceRuntime({ url: () => location.href, send: vi.fn() });
    runtime.beginDetection("fullpage");
    runtime.cancelFullPage();
    runtime.beginDetection("fullpage");
    const before = runtime.snapshot(location.href).snapshot!;
    // Old generation is fenced at its originating content lease: do not feed
    // stale messages to observe(), which only accepts owner-vetted messages.
    runtime.cancelFullPage();
    const canceled = runtime.snapshot(location.href).snapshot!;
    expect(runtime.observe({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 100, currentStep: 2,
      totalScrollSteps: 2, found: 7, domDiagnostics: diagnostic() })).toBe(false);
    expect(runtime.observe({ type: "FULL_PAGE_DETECT_DONE", outcome: "completed",
      candidates: [], totalFound: 7, diagnostics: { observedCandidates: 7,
        retainedCandidates: 7, postprocessedCandidates: 7, refinedCandidates: 7, domDiagnostics: diagnostic() } })).toBe(false);
    expect(runtime.snapshot(location.href).snapshot).toEqual(canceled);
    expect(canceled.seq).toBeGreaterThan(before.seq);
  });

  it("R8A-11 rejects extra diagnostic fields that could smuggle raw page content", () => {
    const runtime = createCandidateWorkspaceRuntime({ url: () => location.href, send: vi.fn() });
    runtime.beginDetection("fullpage");
    runtime.observe({ type: "FULL_PAGE_DETECT_DONE", candidates: [], totalFound: 0, outcome: "no_candidates",
      diagnostics: { observedCandidates: 0, retainedCandidates: 0, postprocessedCandidates: 0, refinedCandidates: 0,
        domDiagnostics: diagnostic() } });
    const snapshot = runtime.snapshot(location.href).snapshot!;
    expect(isWorkspaceSnapshot(snapshot)).toBe(true);
    const topLeak = structuredClone(snapshot);
    Object.assign(topLeak.detection.diagnostics!.domDiagnostics!, { questionBody: "private question text" });
    expect(isWorkspaceSnapshot(topLeak)).toBe(false);
    const reasonLeak = structuredClone(snapshot);
    Object.assign(reasonLeak.detection.diagnostics!.domDiagnostics!.rejected, { rawDomId: "private-dom-id" });
    expect(isWorkspaceSnapshot(reasonLeak)).toBe(false);
    const progressLeak = structuredClone(snapshot);
    progressLeak.fullPage.progress = { type: "FULL_PAGE_DETECT_PROGRESS", progress: 1, found: 0, currentStep: 1, totalScrollSteps: 2,
      domDiagnostics: { ...diagnostic(), rejected: { ...diagnostic().rejected, extra: "private page" } },
    } as typeof progressLeak.fullPage.progress;
    expect(isWorkspaceSnapshot(progressLeak)).toBe(false);
  });

});
