import { describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { runFullPageDetectSession } from "./contentDetectionSession";

const block = (): QuestionBlock => ({
  id: "q1", bbox: { x: 30, y: 80, width: 650, height: 260 },
  previewText: "下列说法正确的是？ A. 甲 B. 乙 C. 丙 D. 丁",
  source: "auto_dom", questionTypeGuess: "single_choice", confidence: 0.96, hasImage: false,
});

function fixture(shouldFail = false) {
  let active: QuestionBlock[] = [block()];
  let legacyMode = "";
  const send = vi.fn((value: unknown) => {
    const m = value as { type: string; candidates?: QuestionBlock[]; outcome?: string; generationId?: string };
    if (m.type !== "FULL_PAGE_DETECT_DONE") return;
    // This callback executes synchronously at the event boundary; no await or
    // panel event loop is permitted to observe a terminal snapshot with stale content state.
    expect(active).toEqual(m.candidates);
    expect(legacyMode).toBe("fullpage");
  });
  const setActiveCandidates = vi.fn((next: QuestionBlock[]) => { active = next; });
  const deps = {
    isFullPageScanRunning: () => false,
    isRuntimeCurrent: () => true,
    cancelFullPageScan: vi.fn(), candidateStatusMap: new Map(),
    logEvent: vi.fn(), destroyHighlightLayer: vi.fn(), stopSpaWatch: vi.fn(),
    refreshLayoutResizeObservation: vi.fn(),
    safeRuntimeSendMessage: send,
    detectCandidatesFullPage: shouldFail ? vi.fn().mockRejectedValue(new Error("scanner detached")) : vi.fn().mockResolvedValue([block()]),
    refineFullPageCandidatesViaManualPipeline: vi.fn().mockImplementation(async (x: QuestionBlock[]) => x),
    resolveFullPageScrollRoot: () => window,
    getFullPageLayoutKey: () => "layout",
    createHighlightLayer: () => ({ setBlocks: vi.fn(), destroy: vi.fn() }),
    refreshFullPageHighlightsAfterLayoutChange: vi.fn(),
    notifySidePanel: vi.fn(),
    setActiveCandidates,
    setActiveHighlightBlocks: vi.fn(),
    setActiveDetectMode: (m: string) => { legacyMode = m; },
    setLastFullPageLayoutKey: vi.fn(), setHighlightLayer: vi.fn(),
  } as unknown as Parameters<typeof runFullPageDetectSession>[0];
  return { deps, send, setActiveCandidates, readActive: () => active };
}
describe("RC03B R14 authoritative commit before Full Page DONE", () => {
  it("R14A first commits content active candidates, then emits generation-bound DONE exactly once", async () => {
    const t = fixture();
    await runFullPageDetectSession(t.deps, "generation-r14");
    const done = t.send.mock.calls.map(([x]) => x as Record<string, unknown>).filter(x => x.type === "FULL_PAGE_DETECT_DONE");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ generationId: "generation-r14", outcome: "completed", totalFound: 1 });
    expect(t.readActive()).toHaveLength(1);
    expect(t.setActiveCandidates).toHaveBeenCalledOnce(); // no post-await duplicate overwrite
  });
  it("R14B a scan exception commits empty active state before publishing failure", async () => {
    const t = fixture(true);
    await runFullPageDetectSession(t.deps, "generation-r14-fail");
    const done = t.send.mock.calls.map(([x]) => x as Record<string, unknown>).filter(x => x.type === "FULL_PAGE_DETECT_DONE");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ generationId: "generation-r14-fail", outcome: "failed", failureStage: "scanning", totalFound: 0 });
    expect(t.readActive()).toEqual([]);
    expect(t.setActiveCandidates).toHaveBeenCalledOnce();
  });
});
