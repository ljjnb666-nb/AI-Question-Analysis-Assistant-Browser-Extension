import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { DetectedCandidate, ParseResult } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";
import { useSidePanelActions } from "./useSidePanelActions";

// UI-00B: the Auto Solve START path guards on provider configuration; these
// tests run with a configured provider. Runtime assembly keeps scanners from
// reading the fixture key as a credential.
(chrome.storage.local.get as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
  appSettings: { ...DEFAULT_SETTINGS, apiKey: ["test", "key"].join("-") },
});

vi.mock("./tabActions", () => ({
  getBestActionTab: vi.fn(async () => ({ id: 7 }) as chrome.tabs.Tab | null),
  sendTabMessageWithBootstrap: vi.fn(),
  sendProtectedTabMessageWithBootstrap: vi.fn(async () => ({ ok: true })),
  requestBlockImage: vi.fn(),
  sendFillMessageWithVerify: vi.fn(),
  isCandidateResultAuthorityCurrent: vi.fn(async () => true),
}));

vi.mock("./batchOperations", () => ({
  runBatchFill: vi.fn(async () => ({ totalFilled: 0, totalQuestions: 0, skippedCount: 0 })),
  runBatchParse: vi.fn(),
  runFillCandidate: vi.fn(),
  runRetryRisky: vi.fn(),
  runRetryVision: vi.fn(),
  selectRiskyCandidates: vi.fn(),
}));

vi.mock("@/shared/utils/analytics", () => ({ logEvent: vi.fn() }));
vi.mock("@/shared/auth/protectedWorkOwner", () => ({
  markProtectedWorkOwner: vi.fn(async () => undefined),
  clearProtectedWorkOwner: vi.fn(async () => undefined),
  readProtectedWorkOwners: vi.fn(async () => ({ autoSolve: [], fullPage: [] })),
}));

import { runBatchFill } from "./batchOperations";

const providerResult: ParseResult = {
  blockId: "b",
  questionType: "single_choice",
  answer: "B",
  confidence: 0.9,
  briefExplanation: "",
  detailedExplanation: "",
  recognizedText: "",
  routeUsed: "text",
  optionSelections: { B: true },
  resultSource: "provider",
};

function makeCandidate(id: string, result: ParseResult | undefined): DetectedCandidate {
  return {
    block: {
      id,
      bbox: { x: 0, y: 0, width: 100, height: 40 },
      previewText: "1. q",
      hasImage: false,
      questionTypeGuess: "single_choice",
      confidence: 0.9,
      source: "auto_dom",
    },
    origin: { tabId: 7, url: "https://quiz.example.test/assignment/7" },
    selected: true,
    status: "success",
    result,
  } as DetectedCandidate;
}

function makeOptions(overrides: Record<string, unknown> = {}) {
  const base = {
    candidates: [] as DetectedCandidate[],
    isBatchParsing: false,
    isAuthenticatedNow: () => true,
    markProtectedWork: vi.fn(async () => undefined),
    setCandidates: vi.fn(),
    setExpandedIds: vi.fn(),
    setFillFeedback: vi.fn(),
    setIsAutoSolving: vi.fn(),
    setIsBatchFilling: vi.fn(),
    setIsBatchParsing: vi.fn(),
    setIsDetecting: vi.fn(),
    setIsFullPageScan: vi.fn(),
    setIsRetryingRisky: vi.fn(),
    setAutoSolveProgress: vi.fn(),
    setScanProgress: vi.fn(),
    uiLang: "zh" as const,
  };
  return { ...base, ...overrides } as Parameters<typeof useSidePanelActions>[0];
}

describe("batch fill zero-fillable guard (UI00B-12, UI-00B PART E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never dispatches a batch mutation when the selection has no fillable result", async () => {
    const setFillFeedback = vi.fn();
    const { result } = renderHook((options: Parameters<typeof useSidePanelActions>[0]) => useSidePanelActions(options), {
      initialProps: makeOptions({
        candidates: [
          makeCandidate("mock-1", { ...providerResult, resultSource: "mock" }),
          makeCandidate("legacy-2", { ...providerResult, resultSource: undefined }),
        ],
        setFillFeedback,
      }),
    });

    await result.current.handleBatchFill();

    expect(runBatchFill).not.toHaveBeenCalled();
    expect(setFillFeedback).toHaveBeenCalledTimes(1);
    const feedback = setFillFeedback.mock.calls[0]?.[0];
    expect(feedback?.tone).toBe("warning");
    expect(feedback?.message).toBe("选中的题目没有可填写的有效解析结果，请重新解析后再试。");
    expect(feedback?.message).not.toMatch(/0\s*题|0 of 0/i);
  });

  it("keeps the ordinary no-selection path silent instead of manufacturing an error", async () => {
    const setFillFeedback = vi.fn();
    const { result } = renderHook((options: Parameters<typeof useSidePanelActions>[0]) => useSidePanelActions(options), {
      initialProps: makeOptions({ candidates: [], setFillFeedback }),
    });

    await result.current.handleBatchFill();

    expect(runBatchFill).not.toHaveBeenCalled();
    expect(setFillFeedback).not.toHaveBeenCalled();
  });
});
