import { describe, expect, it } from "vitest";
import { QuestionRevisionRegistry } from "./questionRevisionRegistry";
import { abortQuestionRevisionAttempt, beginQuestionRevisionAttempt, clearQuestionRevisionAttemptForBlock, isCurrentQuestionRevisionBlock, isQuestionRevisionCurrent } from "./questionRevisionRuntime";

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

  it("cleans only the completed immutable question attempt", () => {
    const controller = new AbortController();
    const identity = beginQuestionRevisionAttempt(block, controller);
    clearQuestionRevisionAttemptForBlock({ ...block, id: "other", identity: { ...block.identity, stableId: "other" } });
    expect(isQuestionRevisionCurrent(identity)).toBe(true);
    clearQuestionRevisionAttemptForBlock(block);
    expect(isQuestionRevisionCurrent(identity)).toBe(false);
  });

  it("SPA-ROUTE final pre-fill gate rejects a pending result after pushState before any reconcile", () => {
    const before = location.href;
    const controller = new AbortController();
    const identity = beginQuestionRevisionAttempt(block, controller);
    expect(isQuestionRevisionCurrent(identity)).toBe(true);
    expect(isCurrentQuestionRevisionBlock(block)).toBe(true);
    history.pushState({}, "", "#phase6-final-gate");
    expect(isQuestionRevisionCurrent(identity)).toBe(false);
    expect(isCurrentQuestionRevisionBlock(block)).toBe(false);
    history.replaceState({}, "", before);
    clearQuestionRevisionAttemptForBlock(block);
  });

  it("SPA-LIFE3 keeps runtime revision state free of detached DOM references", () => {
    const registry = new QuestionRevisionRegistry();
    const owner = document.createElement("section");
    const { version } = registry.observe(block, owner);
    owner.remove();
    expect(JSON.parse(JSON.stringify(version))).toEqual(version);
    const instanceKey = `root-top ${version.stableId}`;
    expect(registry.currentForInstance(instanceKey)?.bindingEpoch).toBe(version.bindingEpoch);
    expect(registry.removeForInstance(instanceKey)?.stableId).toBe("q12");
    expect(registry.currentForInstance(instanceKey)).toBeUndefined();
  });

  it("aborts through the shared helper without clearing a different controller", () => {
    const controller = new AbortController();
    const identity = beginQuestionRevisionAttempt(block, controller);
    abortQuestionRevisionAttempt();
    expect(controller.signal.aborted).toBe(true);
    expect(isQuestionRevisionCurrent(identity)).toBe(false);
  });
});
