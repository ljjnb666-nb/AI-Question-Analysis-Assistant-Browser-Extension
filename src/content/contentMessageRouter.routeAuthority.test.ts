import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { handleContentMessage } from "./contentMessageRouter";

const block = { id: "route-authority-question" } as QuestionBlock;
const result = { answer: "A" } as ParseResult;
let originalUrl = "";

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
    verifyParsedAnswerInPage: vi.fn(() => ({ ok: true, expectedKeys: ["A"], actualKeys: ["A"], message: "verified" })),
  };
}

beforeEach(() => {
  originalUrl = location.href;
});

afterEach(() => {
  window.history.replaceState({}, "", originalUrl);
});

describe("content message route authority", () => {
  it("ROUTE-PRE-FILL-1 rejects the candidate URL after navigation before Fill is handled", () => {
    const expectedUrl = new URL("/assignment/1", originalUrl).href;
    window.history.pushState({}, "", expectedUrl);
    // Side Panel validation completed for /assignment/1, then the SPA navigated before delivery.
    window.history.pushState({}, "", "/assignment/2");
    const deps = makeDeps();
    const sendResponse = vi.fn();

    const keepsChannelOpen = handleContentMessage({ type: "FILL_PARSED_ANSWER", block, result, expectedUrl }, sendResponse, deps);

    expect(keepsChannelOpen).toBe(false);
    expect(deps.fillParsedAnswerInPage).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      filledCount: 0,
      code: "STALE_QUESTION_REVISION",
      message: "STALE_QUESTION_REVISION",
    });
  });

  it("forwards the accepted candidate URL into the authoritative Fill call", async () => {
    const expectedUrl = new URL("/assignment/1", originalUrl).href;
    window.history.pushState({}, "", expectedUrl);
    const deps = makeDeps();
    const response = new Promise<unknown>((resolve) => {
      const keepsChannelOpen = handleContentMessage(
        { type: "FILL_PARSED_ANSWER", block, result, expectedUrl },
        resolve,
        deps,
      );
      expect(keepsChannelOpen).toBe(true);
    });

    await expect(response).resolves.toMatchObject({ ok: true, filledCount: 1 });
    expect(deps.fillParsedAnswerInPage).toHaveBeenCalledWith(block, result, { mode: "manual", expectedUrl });
  });

  it("VERIFY-EXPECTED-URL-1 rejects readback when the page left the candidate URL", () => {
    const expectedUrl = new URL("/assignment/1", originalUrl).href;
    window.history.pushState({}, "", "/assignment/2");
    const deps = makeDeps();
    const sendResponse = vi.fn();

    const keepsChannelOpen = handleContentMessage({ type: "VERIFY_PARSED_ANSWER", block, result, expectedUrl }, sendResponse, deps);

    expect(keepsChannelOpen).toBe(false);
    expect(deps.verifyParsedAnswerInPage).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      expectedKeys: [],
      actualKeys: [],
      message: "STALE_QUESTION_REVISION",
    });
  });
});
