import { describe, expect, it } from "vitest";
import { classifyViewportBoundary, mergeQuestionBoundaryInfo } from "./questionBoundary";
const viewport = { innerHeight: 100 } as Window;
describe("classifyViewportBoundary", () => {
  it("classifies visible and clipped states with a two pixel epsilon", () => {
    expect(classifyViewportBoundary({ y: 0, height: 100 }, viewport).state).toBe("fully-visible");
    expect(classifyViewportBoundary({ y: -3, height: 20 }, viewport).state).toBe("clipped-top");
    expect(classifyViewportBoundary({ y: 90, height: 13 }, viewport).state).toBe("clipped-bottom");
    expect(classifyViewportBoundary({ y: -3, height: 110 }, viewport).state).toBe("clipped-both");
    expect(classifyViewportBoundary({ y: -1, height: 101 }, viewport).state).toBe("fully-visible");
  });
});

describe("mergeQuestionBoundaryInfo", () => {
  const complete = { state: "complete" as const, clippedTop: false, clippedBottom: false, confidence: .9, reasons: ["complete"] };
  const top = { state: "partial-top" as const, clippedTop: true, clippedBottom: false, confidence: .5, reasons: ["top"] };
  const bottom = { state: "partial-bottom" as const, clippedTop: false, clippedBottom: true, confidence: .6, reasons: ["bottom"] };
  it("BM1-BM5 conservatively merges trusted boundary evidence", () => {
    expect(mergeQuestionBoundaryInfo(complete, bottom)).toMatchObject({ state: "partial-bottom", clippedBottom: true });
    expect(mergeQuestionBoundaryInfo(top, complete)).toMatchObject({ state: "partial-top", clippedTop: true });
    expect(mergeQuestionBoundaryInfo(top, bottom)).toMatchObject({ state: "partial-both", clippedTop: true, clippedBottom: true });
    expect(mergeQuestionBoundaryInfo(complete, complete)).toMatchObject({ state: "complete" });
    expect(mergeQuestionBoundaryInfo()).toBeUndefined();
  });
  it("BM6 accumulates three fragments", () => {
    expect(mergeQuestionBoundaryInfo(mergeQuestionBoundaryInfo(top, complete), bottom)).toMatchObject({ state: "partial-both" });
  });
});
