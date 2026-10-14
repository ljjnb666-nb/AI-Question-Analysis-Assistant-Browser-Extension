import { describe, expect, it } from "vitest";
import { resolveQuestionBlockFromBBox } from "./questionBlockResolution";
import type { QuestionBlock } from "@/shared/types";

const userBox = { x: 100, y: 300, width: 700, height: 200 };
// A whole .card collapsed from 3 questions — 6x the user's precise box.
const bigCard = { x: 80, y: 100, width: 740, height: 900 };

function depsWithCandidate(candidateBbox: typeof bigCard | null) {
  const candidate = candidateBbox
    ? ({ bbox: candidateBbox, previewText: "Q1 Q2 Q3", confidence: 0.9 } as QuestionBlock)
    : null;
  return {
    detectCandidatesInViewport: () => [],
    extractRichQuestionPreviewFromElement: () => "",
    extractTextFromBBox: () => "1. [单选题] 中国的首都是？ A. 北京 B. 上海 C. 广州 D. 深圳",
    intersectionArea: () => 0,
    isElementVisible: () => true,
    isExtensionUiElement: () => false,
    refineManualBBoxToQuestionContainer: (b: typeof userBox) => b,
    looksLikeNavigationText: () => false,
    findLikelyQuestionBBoxNear: () => null,
    findBestDetectedCandidateForBBox: () => candidate,
  };
}

describe("MC-001 oversized candidate must not silently override the user box", () => {
  it("keeps the user box and flags snapRejected when the candidate is grossly larger", () => {
    const resolved = resolveQuestionBlockFromBBox(userBox, depsWithCandidate(bigCard));
    expect(resolved.finalBBox).toEqual(userBox);
    expect(resolved.snapRejected).toBe(true);
    expect(resolved.matchedCandidate).not.toBeNull();
  });

  it("still snaps to a reasonably sized candidate", () => {
    const sane = { x: 95, y: 290, width: 710, height: 220 };
    const resolved = resolveQuestionBlockFromBBox(userBox, depsWithCandidate(sane));
    expect(resolved.finalBBox).toEqual(sane);
    expect(resolved.snapRejected).toBe(false);
  });

  it("keeps the user box when no candidate matches", () => {
    const resolved = resolveQuestionBlockFromBBox(userBox, depsWithCandidate(null));
    expect(resolved.finalBBox).toEqual(userBox);
    expect(resolved.snapRejected).toBe(false);
  });
});
