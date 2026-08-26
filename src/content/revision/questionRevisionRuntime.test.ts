import { describe, expect, it } from "vitest";
import { abortQuestionRevisionAttempt, beginQuestionRevisionAttempt, isCurrentQuestionRevisionBlock, isQuestionRevisionCurrent } from "./questionRevisionRuntime";

const block = { id: "q12", bbox: { x: 0, y: 0, width: 10, height: 10 }, previewText: "12. A", hasImage: false, questionTypeGuess: "single_choice" as const, confidence: 1, source: "auto_dom" as const, identity: { stableId: "q12", contentFingerprint: "cf-a", identityVersion: 1 as const, strategy: "native-id" as const, nativeQuestionId: "12", signals: { nativeId: true, content: true, options: true, media: false, structure: true } } };

describe("Phase 6 active provider revision gate", () => {
  it("rejects a late result after deterministic stale cancellation", () => {
    const controller = new AbortController();
    const identity = beginQuestionRevisionAttempt(block, controller);
    expect(isQuestionRevisionCurrent(identity)).toBe(true);
    expect(isCurrentQuestionRevisionBlock(block)).toBe(true);
    abortQuestionRevisionAttempt();
    expect(controller.signal.aborted).toBe(true);
    expect(isQuestionRevisionCurrent(identity)).toBe(false);
    expect(isCurrentQuestionRevisionBlock(block)).toBe(false);
  });
});
