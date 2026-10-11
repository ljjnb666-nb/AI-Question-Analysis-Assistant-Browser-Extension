import { describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { handleFullPageDetect } from "./detectOrchestration";

const sample = (): QuestionBlock => ({
  id: "q1", bbox: { x: 10, y: 30, width: 600, height: 250 },
  previewText: "哪项是正确的？ A. 甲 B. 乙 C. 丙 D. 丁",
  hasImage: false, questionTypeGuess: "single_choice", confidence: 0.9, source: "auto_dom",
});

function setup() {
  const send = vi.fn();
  const detect = vi.fn().mockResolvedValue([] as QuestionBlock[]);
  const refine = vi.fn().mockImplementation(async (items: QuestionBlock[]) => items);
  const deps = {
    isFullPageScanRunning: () => false,
    isRuntimeCurrent: () => true,
    cancelFullPageScan: vi.fn(),
    logEvent: vi.fn(),
    destroyHighlightLayer: vi.fn(),
    stopSpaWatch: vi.fn(),
    candidateStatusMap: new Map(),
    refreshLayoutResizeObservation: vi.fn(),
    safeRuntimeSendMessage: send,
    detectCandidatesFullPage: detect,
    refineFullPageCandidatesViaManualPipeline: refine,
    resolveFullPageScrollRoot: () => window,
    getFullPageLayoutKey: () => "layout",
    createHighlightLayer: () => ({ setBlocks: vi.fn() }),
    refreshFullPageHighlightsAfterLayoutChange: vi.fn(),
    notifySidePanel: vi.fn(),
  };
  return { send, detect, refine, deps: deps as unknown as Parameters<typeof handleFullPageDetect>[0] };
}
function done(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map(([m]) => m as Record<string, unknown>)
    .find((m) => m.type === "FULL_PAGE_DETECT_DONE");
}

describe("RC03B R10 full-page terminal outcome and stage accounting", () => {
  it("preserves scan failure as failed rather than normal zero results", async () => {
    const { send, detect, deps } = setup();
    detect.mockRejectedValue(new Error("failed to read scroll metrics"));
    await handleFullPageDetect(deps);
    expect(done(send)).toMatchObject({
      candidates: [], totalFound: 0, outcome: "failed", failureStage: "scanning",
      diagnostics: { observedCandidates: 0, retainedCandidates: 0, postprocessedCandidates: 0, refinedCandidates: 0 },
    });
  });

  it("distinguishes empty DOM scan from candidate loss in refinement", async () => {
    const zero = setup();
    await handleFullPageDetect(zero.deps);
    expect(done(zero.send)).toMatchObject({ outcome: "no_candidates", totalFound: 0 });

    const lost = setup();
    lost.detect.mockImplementation(async (onProgress: (p: unknown) => void) => {
      onProgress({ progress: 99, found: 1, currentStep: 1, totalScrollSteps: 1,
        observedCandidates: 4, retainedCandidates: 2 });
      return [sample()];
    });
    lost.refine.mockResolvedValue([]);
    await handleFullPageDetect(lost.deps);
    expect(done(lost.send)).toMatchObject({
      outcome: "refinement_empty", totalFound: 0,
      diagnostics: { observedCandidates: 4, retainedCandidates: 2, postprocessedCandidates: 1, refinedCandidates: 0 },
    });
  });

  it("R13A reports initial filtering instead of no candidates when DOM saw raw candidates", async () => {
    const { send, detect, deps } = setup();
    detect.mockImplementation(async (onProgress: (p: unknown) => void) => {
      onProgress({ progress: 99, found: 0, currentStep: 1, totalScrollSteps: 1,
        observedCandidates: 4, retainedCandidates: 0 });
      return [];
    });
    await handleFullPageDetect(deps);
    expect(done(send)).toMatchObject({ outcome: "filtered_empty",
      diagnostics: { observedCandidates: 4, retainedCandidates: 0, postprocessedCandidates: 0 } });
  });

  it("R13B reports postprocessing loss instead of no candidates when scan retained them", async () => {
    const { send, detect, deps } = setup();
    detect.mockImplementation(async (onProgress: (p: unknown) => void) => {
      onProgress({ progress: 99, found: 2, currentStep: 1, totalScrollSteps: 1,
        observedCandidates: 3, retainedCandidates: 2 });
      return []; // postProcessCandidates removed the accepted scan candidates
    });
    await handleFullPageDetect(deps);
    expect(done(send)).toMatchObject({ outcome: "postprocess_empty",
      diagnostics: { observedCandidates: 3, retainedCandidates: 2, postprocessedCandidates: 0 } });
  });

  it("R13C synchronously commits the final content state before DONE is sent", async () => {
    const { send, detect, deps } = setup();
    detect.mockResolvedValue([sample()]);
    const commitBeforeDone = vi.fn();
    deps.commitBeforeDone = commitBeforeDone;
    send.mockImplementation((m) => {
      if (m.type === "FULL_PAGE_DETECT_DONE") {
        expect(commitBeforeDone).toHaveBeenCalledOnce();
        expect(commitBeforeDone).toHaveBeenCalledWith(expect.objectContaining({ activeCandidates: [expect.objectContaining({ id: "q1" })] }));
      }
    });
    await handleFullPageDetect(deps);
    expect(done(send)).toMatchObject({ outcome: "completed", totalFound: 1 });
  });

  it("identifies the refinement exception without fabricating an empty success", async () => {
    const { send, detect, refine, deps } = setup();
    detect.mockResolvedValue([sample()]);
    refine.mockRejectedValue(new Error("detached DOM during refinement"));
    await handleFullPageDetect(deps);
    expect(done(send)).toMatchObject({ outcome: "failed", failureStage: "refining",
      diagnostics: { postprocessedCandidates: 1, refinedCandidates: 0 } });
  });
});
