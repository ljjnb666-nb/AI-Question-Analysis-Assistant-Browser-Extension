import { describe, expect, it } from "vitest";
import { recoverDetachedChoiceLabels } from "./detachedChoiceLabels";
import { countOptionMarkersInText, inferQuestionType } from "./domText";
import { isLikelyCompleteQuestionText } from "./domDetectorPostprocess";

const stem = "凡是符合自己所维护的道德观念时就会产生积极情绪，这属于哪种品德心理结构？（ ）";
const detached = `${stem}
A
道德认识
B
道德情感
C
道德意志
D
道德行为
题型：单选题`;

describe("RC-PILOT-03B detached ABCD choice labels", () => {
  it("restores four complete bare labels before the existing question filters run", () => {
    const restored = recoverDetachedChoiceLabels(detached);
    expect(restored).toContain("A.\n道德认识");
    expect(restored).toContain("B.\n道德情感");
    expect(restored).toContain("C.\n道德意志");
    expect(restored).toContain("D.\n道德行为");
    expect(countOptionMarkersInText(restored)).toBeGreaterThanOrEqual(4);
    expect(inferQuestionType(restored)).toBe("single_choice");
    expect(isLikelyCompleteQuestionText(restored, "single_choice")).toBe(true);
  });

  it("supports bare marker and text on the same visual line", () => {
    const raw = `${stem}\nA 道德认识\nB 道德情感\nC 道德意志\nD 道德行为`;
    expect(recoverDetachedChoiceLabels(raw)).toContain("D. 道德行为");
  });

  it("never turns an incomplete quartet or orphan options into a candidate", () => {
    const partial = `${stem}\nA\n道德认识\nB\n道德情感\nC\n道德意志`;
    expect(recoverDetachedChoiceLabels(partial)).toBe(partial);
    const orphan = "A\n道德认识\nB\n道德情感\nC\n道德意志\nD\n道德行为";
    expect(recoverDetachedChoiceLabels(orphan)).toBe(orphan);
  });

  it("will not merge options from two distinct question cards", () => {
    const split = `${stem}\nA\n道德认识\nB\n道德情感\n另一道题的题目是什么？\nC\n道德意志\nD\n道德行为`;
    // If another question starts in an option segment, the source must be
    // segmented first rather than recovering one mixed candidate.
    expect(recoverDetachedChoiceLabels(split)).toBe(split);
  });

  it("does not rewrite conventional A./B./C./D. markup or ordinary navigation", () => {
    const normal = `${stem} A. 道德认识 B. 道德情感 C. 道德意志 D. 道德行为`;
    expect(recoverDetachedChoiceLabels(normal)).toBe(normal);
    const menu = "题库首页\nA\n高考\nB\n考研\nC\n公务员\nD\n职业资格";
    expect(recoverDetachedChoiceLabels(menu)).toBe(menu);
  });
});
