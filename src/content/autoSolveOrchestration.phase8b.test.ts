import { describe, expect, it, vi } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { runAutoSolveAll } from "./autoSolveOrchestration";

describe("Phase 8B Auto Solve transaction stop", () => {
  it("reports a failed fill and does not advance after a transaction failure", async () => {
    const block: QuestionBlock = {
      id: "q-phase8b",
      bbox: { x: 0, y: 0, width: 320, height: 120 },
      previewText: "1. A sample choice question. A. alpha B. beta",
      hasImage: false,
      confidence: 1,
      questionTypeGuess: "single_choice",
      source: "auto_dom",
    };
    const parsed: ParseResult = {
      blockId: block.id,
      questionType: "single_choice",
      answer: "A",
      confidence: 0.99,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: block.previewText,
      routeUsed: "text",
    };
    let running = false;
    const controller = {
      isRunning: () => running,
      setRunning: (next: boolean) => { running = next; },
      isStopRequested: () => false,
      requestStop: vi.fn(),
    };
    const sendAutoSolveDone = vi.fn();
    const sendAutoSolveProgress = vi.fn();
    const fillParsedAnswerInPage = vi.fn(async () => ({
      ok: false,
      filledCount: 0,
      code: "PARTIAL_MUTATION_UNPROVABLE" as const,
      message: "PARTIAL_MUTATION_UNPROVABLE",
    }));
    const verifyParsedAnswerInPage = vi.fn(() => ({ ok: true, message: "later readback was positive" }));
    const clickNextQuestionButton = vi.fn(() => true);
    const resolveQuestionAdvance = vi.fn(async () => true);
    const deps = {
      activeCandidates: [block],
      activeDetectMode: "viewport" as const,
      clickNextQuestionButton,
      detectCandidatesFullPage: vi.fn(async () => []),
      detectCandidatesInViewport: vi.fn(() => [block]),
      detectTotalQuestionCount: vi.fn(() => 1),
      extractAutoSolveQuestionOrder: vi.fn(() => 1),
      extractQuestionImageUrlFromBBox: vi.fn(() => null),
      extractRichQuestionPreviewFromElement: vi.fn(() => ""),
      extractTextFromBBox: vi.fn(() => ""),
      fillParsedAnswerInPage,
      findBestDetectedCandidateForBBox: vi.fn(() => null),
      findMatchingFullPageCandidate: vi.fn(() => null),
      findNextQuestionButton: vi.fn(() => document.createElement("button")),
      findReusableHistoryEntry: vi.fn(() => null),
      getAutoSolveFingerprint: vi.fn((candidate: QuestionBlock) => candidate.id),
      getAutoSolveTextFingerprint: vi.fn((text: string) => text),
      getScrollLeft: vi.fn(() => 0),
      hasVisibleAutoSolveMedia: vi.fn(() => false),
      inferAutoSolveQuestionType: vi.fn(() => "single_choice" as const),
      inspectAutoSolveAnswerState: vi.fn(() => ({ mode: "choice" as const, answeredCount: 1, totalCount: 1, complete: true })),
      isChoiceLikeQuestionType: vi.fn(() => true),
      isExtensionUiElement: vi.fn(() => false),
      isCurrentAutoSolveResult: vi.fn(() => true),
      loadHistory: vi.fn(async () => []),
      parseBlockForAutoSolve: vi.fn(async () => parsed),
      parseBlockForAutoSolveQuickReview: vi.fn(async () => parsed),
      parseBlockForAutoSolveReview: vi.fn(async () => parsed),
      pauseMs: vi.fn(async () => {}),
      pickBestAutoSolvePreviewText: vi.fn((_raw: string, rich: string) => rich),
      pickLiveAutoSolveBlock: vi.fn(() => block),
      projectViewportBboxToAbsolute: vi.fn((_bbox, _root) => block.bbox),
      recordAutoSolveHistory: vi.fn(async () => true),
      normalizeQuestionText: vi.fn((text: string) => text),
      refineFullPageCandidatesViaManualPipeline: vi.fn(async (candidates: QuestionBlock[]) => candidates),
      refineViewportCandidate: vi.fn(),
      reportLocationHostname: vi.fn(() => "example.test"),
      resolveQuestionBlockFromBBox: vi.fn(() => ({ refinedBBox: block.bbox, finalBBox: block.bbox, previewText: block.previewText, matchedCandidate: block })),
      resolveQuestionAdvance,
      resolveScrollRoot: vi.fn(() => document.documentElement),
      sendAutoSolveDone,
      sendAutoSolveProgress,
      setScrollPosition: vi.fn(),
      shouldPersistAutoSolveParseResult: vi.fn(() => true),
      shouldPreferViewportPreview: vi.fn(() => true),
      shouldRetryUnstableChoiceParse: vi.fn(() => false),
      shouldReviewLowConfidenceHistory: vi.fn(() => false),
      shouldStopAutoSolveAtTail: vi.fn(() => false),
      sortAutoSolveCandidates: vi.fn((candidates: QuestionBlock[]) => candidates),
      verifyParsedAnswerInPage,
    };

    await runAutoSolveAll(controller, deps as never);

    expect(fillParsedAnswerInPage).toHaveBeenCalledOnce();
    expect(verifyParsedAnswerInPage).not.toHaveBeenCalled();
    expect(sendAutoSolveDone).toHaveBeenCalledOnce();
    expect(sendAutoSolveDone).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      solved: 0,
      filled: 0,
      message: "PARTIAL_MUTATION_UNPROVABLE",
    }));
    expect(clickNextQuestionButton).not.toHaveBeenCalled();
    expect(resolveQuestionAdvance).not.toHaveBeenCalled();
    expect(running).toBe(false);
  });
});
