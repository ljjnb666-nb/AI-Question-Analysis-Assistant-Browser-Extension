import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type DetectedCandidate, type ParseResult, type QuestionBlock } from "@/shared/types";
import { DEMO_RESULT_NOT_FILLABLE, UNVERIFIED_RESULT_SOURCE } from "@/shared/ai/parseResultAuthority";
import { runBatchFill, runFillCandidate } from "./batchOperations";

const origin = { tabId: 41, url: "https://quiz.example.test/assignment/7" };

const makeBlock = (id = "block-1"): QuestionBlock => ({
  id,
  identity: {
    stableId: `stable-${id}`,
    contentFingerprint: `fingerprint-${id}`,
    identityVersion: 1,
    strategy: "content-only",
    signals: { nativeId: false, content: true, options: true, media: false, structure: true },
  },
  runtimeQuestionHandle: `rqh_${id.padEnd(32, "0").slice(0, 32)}`,
  bbox: { x: 0, y: 0, width: 120, height: 60 },
  previewText: "1. prompt A. a B. b",
  hasImage: false,
  questionTypeGuess: "single_choice",
  confidence: 0.9,
  source: "auto_dom",
});

const makeResult = (overrides: Partial<ParseResult> = {}): ParseResult => ({
  blockId: "block-1",
  questionType: "single_choice",
  answer: "B",
  confidence: 0.9,
  briefExplanation: "brief",
  detailedExplanation: "detail",
  recognizedText: "recognized",
  routeUsed: "vision",
  resultSource: "provider",
  ...overrides,
});

const makeCandidate = (id: string, result: ParseResult | undefined, overrides: Partial<DetectedCandidate> = {}): DetectedCandidate => ({
  block: makeBlock(id),
  origin,
  selected: true,
  status: "success",
  result,
  ...overrides,
});

function createFillDeps() {
  return {
    isCandidateCurrent: vi.fn(async () => true),
    setCandidates: vi.fn(),
    sendFillMessageWithVerify: vi.fn(async () => ({ ok: true, filledCount: 1, message: "FILLED_VERIFIED" })),
  };
}

describe("side panel fill provenance gate (UI-00A)", () => {
  it("UI00A-04: a mock result is refused before any fill message is crafted", async () => {
    const deps = createFillDeps();
    const candidate = makeCandidate("mock-1", makeResult({ resultSource: "mock" }));

    const response = await runFillCandidate(candidate, deps);

    expect(response?.ok).toBe(false);
    expect(response?.code).toBe(DEMO_RESULT_NOT_FILLABLE);
    expect(deps.sendFillMessageWithVerify).not.toHaveBeenCalled();
    expect(deps.isCandidateCurrent).not.toHaveBeenCalled();
  });

  it("UI00A-07: a legacy candidate result without provenance cannot be filled directly", async () => {
    const deps = createFillDeps();
    const legacyResult = makeResult();
    delete (legacyResult as Partial<ParseResult>).resultSource;

    const response = await runFillCandidate(makeCandidate("legacy-1", legacyResult), deps);

    expect(response?.ok).toBe(false);
    expect(response?.code).toBe(UNVERIFIED_RESULT_SOURCE);
    expect(deps.sendFillMessageWithVerify).not.toHaveBeenCalled();
  });

  it("UI00A-05: batch fill skips mock candidates and mutates nothing through them", async () => {
    const deps = createFillDeps();
    const providerCandidate = { ...makeCandidate("prov-1", makeResult({ resultSource: "provider" })), selected: true };
    const mockCandidate = makeCandidate("mock-2", makeResult({ resultSource: "mock" }));

    const { totalFilled, totalQuestions } = await runBatchFill([providerCandidate, mockCandidate], deps);

    expect(totalQuestions).toBe(1);
    expect(totalFilled).toBe(1);
    expect(deps.sendFillMessageWithVerify).toHaveBeenCalledTimes(1);
    expect(deps.sendFillMessageWithVerify).toHaveBeenCalledWith(
      origin.tabId,
      providerCandidate.block,
      expect.objectContaining({ resultSource: "provider" }),
      origin.url,
    );
  });

  it("UI00A-05: a batch of only mock/legacy results sends zero fill messages", async () => {
    const deps = createFillDeps();
    const legacyResult = makeResult();
    delete (legacyResult as Partial<ParseResult>).resultSource;

    const { totalFilled, totalQuestions } = await runBatchFill([
      makeCandidate("mock-1", makeResult({ resultSource: "mock" })),
      makeCandidate("legacy-2", legacyResult),
    ], deps);

    expect(totalQuestions).toBe(0);
    expect(totalFilled).toBe(0);
    expect(deps.sendFillMessageWithVerify).not.toHaveBeenCalled();
  });

  it("UI00A-08: provider-result fills keep the existing dispatch behavior", async () => {
    const deps = createFillDeps();

    const response = await runFillCandidate(makeCandidate("prov-1", makeResult({ resultSource: "provider" })), deps);

    expect(response?.ok).toBe(true);
    expect(deps.sendFillMessageWithVerify).toHaveBeenCalledTimes(1);
    expect(DEFAULT_SETTINGS.language).toBe("zh");
  });
});
