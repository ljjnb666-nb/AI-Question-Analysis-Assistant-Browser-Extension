import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { fillAnswerIntoScope, fillParsedAnswerInPage } from "./answerFiller";
import { handleContentMessage } from "./contentMessageRouter";
import { DEMO_RESULT_NOT_FILLABLE, UNVERIFIED_RESULT_SOURCE } from "@/shared/ai/parseResultAuthority";

const block: QuestionBlock = {
  id: "ui00a-fill-block",
  bbox: { x: 100, y: 100, width: 500, height: 240 },
  previewText: "1. prompt A. a B. b",
  hasImage: false,
  questionTypeGuess: "single_choice",
  confidence: 1,
  source: "auto_dom",
};

function makeResult(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    blockId: block.id,
    questionType: "single_choice",
    answer: "B",
    confidence: 0.91,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: block.previewText,
    routeUsed: "text",
    ...overrides,
  };
}

function setRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }),
  });
}

/** Real question DOM whose mutation state can be proven unchanged. */
function buildChoiceDom() {
  document.body.innerHTML = `
    <form id="exam-form">
      <section class="question-item" id="q">
        <label id="opt-a"><input id="a" type="radio" name="q1" /> A. a</label>
        <label id="opt-b"><input id="b" type="radio" name="q1" /> B. b</label>
        <button type="submit" id="submit-btn">Submit</button>
      </section>
    </form>
  `;
  for (const [idx, id] of ["opt-a", "opt-b"].entries()) {
    const row = document.getElementById(id)!;
    setRect(row, { left: 120, top: 120 + idx * 40, width: 260, height: 28 });
    setRect(row.querySelector("input")!, { left: 126, top: 126 + idx * 40, width: 16, height: 16 });
  }
  let submitEvents = 0;
  document.getElementById("exam-form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    submitEvents += 1;
  });
  const readState = () => ({
    a: (document.getElementById("a") as HTMLInputElement).checked,
    b: (document.getElementById("b") as HTMLInputElement).checked,
    submitEvents,
    html: document.getElementById("q")!.innerHTML,
  });
  return { readState };
}

describe("answerFiller provenance gate (UI-00A)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("UI00A-04: a mock result never mutates the page on a single Fill", async () => {
    const { readState } = buildChoiceDom();
    const before = readState();

    const outcome = await fillParsedAnswerInPage(block, makeResult({ resultSource: "mock" }), { mode: "manual" });

    expect(outcome.ok).toBe(false);
    expect(outcome.filledCount).toBe(0);
    expect(outcome.code).toBe(DEMO_RESULT_NOT_FILLABLE);
    expect(readState()).toEqual(before);
  });

  it("UI00A-06: a mock result cannot mutate the page through the Auto Solve fill path", async () => {
    const { readState } = buildChoiceDom();
    const before = readState();

    const outcome = await fillParsedAnswerInPage(block, makeResult({ resultSource: "mock" }), { mode: "auto" });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(DEMO_RESULT_NOT_FILLABLE);
    expect(readState()).toEqual(before);
  });

  it("UI00A-07: a legacy result without provenance has no fill authority", async () => {
    const { readState } = buildChoiceDom();
    const before = readState();
    const legacyResult = makeResult();
    delete (legacyResult as Partial<ParseResult>).resultSource;

    const messageOutcome = await fillParsedAnswerInPage(block, legacyResult, { mode: "manual" });
    const directOutcome = await fillAnswerIntoScope(document.getElementById("q")!, block.bbox, legacyResult);

    expect(messageOutcome.code).toBe(UNVERIFIED_RESULT_SOURCE);
    expect(messageOutcome.ok).toBe(false);
    expect(directOutcome.code).toBe(UNVERIFIED_RESULT_SOURCE);
    expect(directOutcome.ok).toBe(false);
    expect(readState()).toEqual(before);
  });

  it("UI00A-08: a provider result keeps normal fill behavior", async () => {
    const { readState } = buildChoiceDom();

    const outcome = await fillAnswerIntoScope(document.getElementById("q")!, block.bbox, makeResult({ resultSource: "provider" }));

    expect(outcome.ok).toBe(true);
    expect((document.getElementById("b") as HTMLInputElement).checked).toBe(true);
    expect(readState().a).toBe(false);
  });

  it("UI00A-13: the mock guard does not weaken stale-question authority for provider results", async () => {
    buildChoiceDom();

    const stale = await fillParsedAnswerInPage(
      block,
      makeResult({ resultSource: "provider" }),
      { mode: "manual", isRuntimeCurrent: () => false },
    );
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe("STALE_QUESTION_REVISION");

    // The provenance gate sits before the URL fence and never leaks a mock
    // result into it either.
    const demo = await fillParsedAnswerInPage(
      block,
      makeResult({ resultSource: "mock" }),
      { mode: "manual", expectedUrl: "https://elsewhere.example.test/page" },
    );
    expect(demo.code).toBe(DEMO_RESULT_NOT_FILLABLE);
  });

  it("UI00A-14: pre-existing non-provenance failure codes are unchanged for provider results", async () => {
    buildChoiceDom();
    const outcome = await fillParsedAnswerInPage(
      block,
      makeResult({ resultSource: "provider" }),
      { mode: "manual", expectedUrl: "https://elsewhere.example.test/page" },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("STALE_QUESTION_REVISION");
  });

  it("UI00A-15: filling a provider result never triggers automatic submission", async () => {
    const { readState } = buildChoiceDom();

    await fillAnswerIntoScope(document.getElementById("q")!, block.bbox, makeResult({ resultSource: "provider" }));
    // Even a rejected fill must not interact with the form.
    await fillParsedAnswerInPage(block, makeResult({ resultSource: "mock" }), { mode: "manual" });

    expect(readState().submitEvents).toBe(0);
  });
});

describe("content message router provenance gate (UI-00A)", () => {
  function makeDeps() {
    return {
      cancelFullPageScan: vi.fn(),
      cancelManualCapture: vi.fn(),
      captureBlockImage: vi.fn(async () => null),
      clearHighlights: vi.fn(),
      closeFloatingResult: vi.fn(),
      fillParsedAnswerInPage: vi.fn(async () => ({ ok: true, filledCount: 1 })),
      flashCandidate: vi.fn(),
      handleAutoDetect: vi.fn(),
      handleFullPageDetect: vi.fn(),
      startAutoSolveAll: vi.fn(),
      startManualCapture: vi.fn(),
      stopAutoSolveAll: vi.fn(),
      updateCandidateSelection: vi.fn(),
      validateQuestionResultAuthority: vi.fn(() => true),
      verifyParsedAnswerInPage: vi.fn(() => ({ ok: true, expectedKeys: ["B"], actualKeys: ["B"], message: "verified" })),
    };
  }

  function makeRouterDeps() {
    const deps = makeDeps();
    return { deps, routerDeps: deps };
  }

  it("UI00A-04: a hand-crafted FILL message with a mock result is rejected at the message boundary", () => {
    const { deps } = makeRouterDeps();
    const sendResponse = vi.fn();

    const keepsChannelOpen = handleContentMessage(
      { type: "FILL_PARSED_ANSWER", block, result: makeResult({ resultSource: "mock" }) },
      sendResponse,
      deps,
    );

    expect(keepsChannelOpen).toBe(false);
    expect(deps.fillParsedAnswerInPage).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      filledCount: 0,
      code: DEMO_RESULT_NOT_FILLABLE,
      message: DEMO_RESULT_NOT_FILLABLE,
    });
  });

  it("UI00A-07: a legacy FILL message without provenance is rejected as unverified", () => {
    const { deps } = makeRouterDeps();
    const legacyResult = makeResult();
    delete (legacyResult as Partial<ParseResult>).resultSource;
    const sendResponse = vi.fn();

    handleContentMessage({ type: "FILL_PARSED_ANSWER", block, result: legacyResult }, sendResponse, deps);

    expect(deps.fillParsedAnswerInPage).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      filledCount: 0,
      code: UNVERIFIED_RESULT_SOURCE,
      message: UNVERIFIED_RESULT_SOURCE,
    });
  });

  it("UI00A-08: a provider-result FILL message still reaches the fill core", async () => {
    const { deps } = makeRouterDeps();
    const response = new Promise<unknown>((resolve) => {
      const keepsChannelOpen = handleContentMessage(
        { type: "FILL_PARSED_ANSWER", block, result: makeResult({ resultSource: "provider" }) },
        resolve,
        deps,
      );
      expect(keepsChannelOpen).toBe(true);
    });

    await expect(response).resolves.toMatchObject({ ok: true, filledCount: 1 });
    expect(deps.fillParsedAnswerInPage).toHaveBeenCalledWith(block, expect.objectContaining({ resultSource: "provider" }), { mode: "manual", expectedUrl: undefined });
  });
});
