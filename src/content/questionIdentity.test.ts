import { describe, expect, it } from "vitest";
import { findReusableHistoryEntry, getAutoSolveFingerprint } from "./autoSolveHeuristics";
import { attachQuestionIdentity, buildQuestionIdentity, canonicalizeQuestionImageUrl, canonicalizeQuestionText, extractNativeQuestionId, stableHash } from "./questionIdentity";

function input(overrides: Partial<Parameters<typeof buildQuestionIdentity>[0]> = {}) {
  return { text: "4. Which answer is correct? A. one B. two C. three D. four", questionType: "single_choice" as const, ...overrides };
}

describe("Question Model V2 stable identity", () => {
  it("keeps identity across equivalent rerenders while runtime observations may differ", () => {
    const first = attachQuestionIdentity({ id: "auto-1-random", bbox: { x: 0, y: 200, width: 700, height: 240 }, previewText: input().text, hasImage: false, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom" });
    const second = attachQuestionIdentity({ ...first, id: "auto-2-random", bbox: { ...first.bbox, y: 700 } });
    expect(first.id).not.toBe(second.id);
    expect(first.identity?.stableId).toBe(second.identity?.stableId);
    expect(first.identity?.contentFingerprint).toBe(second.identity?.contentFingerprint);
    expect(getAutoSolveFingerprint(first)).toBe(getAutoSolveFingerprint(second));
  });

  it("prefers same-host stable identity reuse and remains compatible with legacy history blocks", () => {
    const current = attachQuestionIdentity({ id: "runtime-current", bbox: { x: 0, y: 0, width: 700, height: 200 }, previewText: input().text, hasImage: false, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom" });
    const stableEntry = {
      id: "history-stable",
      timestamp: 1,
      host: "example.com",
      block: { ...current, id: "runtime-old" },
      result: { blockId: "runtime-old", questionType: "single_choice" as const, answer: "A", confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: current.previewText, routeUsed: "text" as const, optionSelections: { A: true } },
    };
    expect(findReusableHistoryEntry([stableEntry], current, "example.com")).toBe(stableEntry);
    expect(findReusableHistoryEntry([stableEntry], current, "other.example")).toBeNull();
    const legacyEntry = { ...stableEntry, block: { ...stableEntry.block, identity: undefined } };
    expect(findReusableHistoryEntry([legacyEntry], current, "example.com")).toBe(legacyEntry);
  });

  it("fails closed when two V2 identities have different stable ids despite matching content", () => {
    const q4 = attachQuestionIdentity({ id: "runtime-q4", bbox: { x: 0, y: 0, width: 700, height: 200 }, previewText: input().text, hasImage: false, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom" });
    const q7 = attachQuestionIdentity({ ...q4, id: "runtime-q7", previewText: "7. Which answer is correct? A. one B. two C. three D. four" });
    const entry = { id: "history-q4", timestamp: 1, host: "example.com", block: q4, result: { blockId: q4.id, questionType: "single_choice" as const, answer: "A", confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: q4.previewText, routeUsed: "text" as const, optionSelections: { A: true } } };
    expect(q4.identity.contentFingerprint).toBe(q7.identity.contentFingerprint);
    expect(q4.identity.stableId).not.toBe(q7.identity.stableId);
    expect(findReusableHistoryEntry([entry], q7, "example.com")).toBeNull();
  });

  it("normalizes whitespace without changing semantic content", () => {
    expect(canonicalizeQuestionText(" Which   answer is correct? \r\n A. one ")).toBe(canonicalizeQuestionText("Which answer is correct?\nA. one"));
  });

  it("changes fingerprints for meaningful stem or option changes", () => {
    const base = buildQuestionIdentity(input());
    expect(buildQuestionIdentity(input({ text: "4. Which answer is incorrect? A. one B. two C. three D. four" })).contentFingerprint).not.toBe(base.contentFingerprint);
    expect(buildQuestionIdentity(input({ text: "4. Which answer is correct? A. one B. two C. changed D. four" })).contentFingerprint).not.toBe(base.contentFingerprint);
  });

  it("keeps content identity but separates identical instances by ordinal", () => {
    const q4 = buildQuestionIdentity(input());
    const q7 = buildQuestionIdentity(input({ text: "7. Which answer is correct? A. one B. two C. three D. four" }));
    expect(q4.contentFingerprint).toBe(q7.contentFingerprint);
    expect(q4.stableId).not.toBe(q7.stableId);
  });

  it("uses a stable native question id over ordinal movement and ignores unstable-looking ids", () => {
    const native = document.createElement("div");
    native.setAttribute("data-question-id", "92831");
    const first = buildQuestionIdentity(input({ element: native }));
    const second = buildQuestionIdentity(input({ element: native, text: "6. Which answer is correct? A. one B. two C. three D. four" }));
    expect(first.strategy).toBe("native-id");
    expect(first.stableId).toBe(second.stableId);
    const unstable = document.createElement("div");
    unstable.id = "react-1720000000000";
    expect(extractNativeQuestionId(unstable)).toBeUndefined();
  });

  it("uses strong attributes before generic ids and rejects static or accessibility identifiers", () => {
    const strong = document.createElement("div");
    strong.id = "question";
    strong.setAttribute("data-question-id", "92831");
    expect(extractNativeQuestionId(strong)).toBe("92831");
    const instance = document.createElement("div");
    instance.id = "question-92831";
    expect(extractNativeQuestionId(instance)).toBe("question-92831");
    const dataId = document.createElement("div");
    dataId.setAttribute("data-id", "item");
    dataId.setAttribute("aria-labelledby", "question-label");
    expect(extractNativeQuestionId(dataId)).toBeUndefined();
  });

  it("does not collide when a single-question SPA replaces content in a static container", () => {
    const page = document.createElement("div");
    page.id = "question";
    const first = buildQuestionIdentity(input({ element: page, text: "1. Question A? A. one B. two C. three D. four" }));
    const second = buildQuestionIdentity(input({ element: page, text: "2. Question B? A. one B. two C. three D. four" }));
    expect(first.nativeQuestionId).toBeUndefined();
    expect(first.stableId).not.toBe(second.stableId);
  });

  it("preserves formula text and normalizes media URLs conservatively", () => {
    const formula = buildQuestionIdentity(input({ text: "4. For G(s)=10+2/s, which answer is correct? A. one B. two C. three D. four" }));
    const changed = buildQuestionIdentity(input({ text: "4. For G(s)=10+3/s, which answer is correct? A. one B. two C. three D. four" }));
    expect(formula.contentFingerprint).not.toBe(changed.contentFingerprint);
    expect(canonicalizeQuestionImageUrl("https://example.com/figure.png?timestamp=123#preview")).toBe("https://example.com/figure.png");
    expect(canonicalizeQuestionImageUrl("https://example.com/image?id=123")).not.toBe(canonicalizeQuestionImageUrl("https://example.com/image?id=456"));
    expect(canonicalizeQuestionImageUrl("https://example.com/image?b=2&a=1")).toBe(canonicalizeQuestionImageUrl("https://example.com/image?a=1&b=2"));
    expect(canonicalizeQuestionImageUrl("https://example.com/image?a=1#first")).toBe(canonicalizeQuestionImageUrl("https://example.com/image?a=1#second"));
  });

  it("has no collisions across a representative canonical input set", () => {
    const hashes = new Set(Array.from({ length: 1000 }, (_, index) => stableHash(`question-${index}-A-${index * 17}`)));
    expect(hashes.size).toBe(1000);
  });
});
