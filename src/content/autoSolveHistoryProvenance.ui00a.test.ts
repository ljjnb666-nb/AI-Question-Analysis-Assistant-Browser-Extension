import { describe, expect, it } from "vitest";
import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import { findReusableHistoryEntry } from "./autoSolveHeuristics";

const blockIdentity = {
  stableId: "stable-q1",
  contentFingerprint: "fingerprint-q1",
  identityVersion: 1 as const,
  strategy: "content-only" as const,
  signals: { nativeId: false, content: true, options: true, media: false, structure: true },
};

const currentBlock: QuestionBlock = {
  id: "q1",
  identity: blockIdentity,
  bbox: { x: 0, y: 0, width: 320, height: 120 },
  previewText: "12. Which value equals 2 + 2? A. 3 B. 4",
  hasImage: false,
  questionTypeGuess: "single_choice",
  confidence: 0.9,
  source: "auto_dom",
};

const providerResult: ParseResult = {
  blockId: "q1",
  questionType: "single_choice",
  answer: "B",
  confidence: 0.95,
  briefExplanation: "provider",
  detailedExplanation: "provider",
  recognizedText: currentBlock.previewText,
  routeUsed: "text",
  optionSelections: { B: true },
  resultSource: "provider",
};

function historyEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "entry-1",
    timestamp: Date.now(),
    block: currentBlock,
    result: providerResult,
    host: "quiz.example.test",
    ...overrides,
  };
}

describe("auto solve history reuse provenance gate (UI-00A)", () => {
  it("UI00A-12: a legacy history entry lacking provenance is never reused as a fill answer", () => {
    const legacyResult: ParseResult = { ...providerResult };
    delete (legacyResult as Partial<ParseResult>).resultSource;

    expect(findReusableHistoryEntry([historyEntry({ result: legacyResult })], currentBlock, "quiz.example.test")).toBeNull();
  });

  it("UI00A-12: a mock history entry is never reused as a fill answer", () => {
    const mockEntry = historyEntry({ result: { ...providerResult, resultSource: "mock" } });
    expect(findReusableHistoryEntry([mockEntry], currentBlock, "quiz.example.test")).toBeNull();
  });

  it("a provider-provenance history entry keeps being reusable", () => {
    expect(findReusableHistoryEntry([historyEntry()], currentBlock, "quiz.example.test")).not.toBeNull();
  });
});

describe("legacy history readability (UI-00A)", () => {
  it("UI00A-11: an old persisted payload without resultSource still loads and displays its data", async () => {
    const legacyResult: ParseResult = { ...providerResult };
    delete (legacyResult as Partial<ParseResult>).resultSource;
    const legacyEntry = historyEntry({ result: legacyResult });
    // Exactly what an old chrome.storage payload looks like: no resultSource
    // key anywhere in the serialized result.
    const persisted = JSON.parse(JSON.stringify([legacyEntry]));
    expect("resultSource" in persisted[0].result).toBe(false);

    const chromeMock = (globalThis as unknown as {
      chrome: { storage: { local: { get: { mockResolvedValue: (value: unknown) => void } } } };
    }).chrome;
    chromeMock.storage.local.get.mockResolvedValue({ parseHistory: persisted });

    const { loadHistory } = await import("@/shared/utils/storage");
    const loaded = await loadHistory();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.result.answer).toBe("B");
    expect("resultSource" in loaded[0]!.result).toBe(false);
    expect(loaded[0]!.block.previewText).toBe(currentBlock.previewText);
  });
});
