import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAutoSolveFingerprint, getAutoSolveTextFingerprint } from "../autoSolveHeuristics";
import { extractReadableQuestionNodeText } from "../questionText";
import { detectCandidatesInViewport } from "./domDetector";
import { hasMeaningfulVisualContent, pickQuestionImageFromElement } from "./domDetectorVisual";
import { createImageQuestionFixture, createOptionImageQuestionFixture, mockLocation, setElementRect, setViewport } from "./testFixtures/questionFixtureFactory";

const readableTextDeps = {
  isExtensionUiElement: () => false,
  normalizeQuestionText: (text: string) => text.replace(/\s+/g, " ").trim(),
};

describe("Universal Question Engine V2 Phase 0 baseline lock", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockLocation();
    setViewport();
  });

  afterEach(() => vi.restoreAllMocks());

  it("does_not_merge_top_clipped_previous_question_with_next_partial_question", () => {
    createImageQuestionFixture({ id: "previous", ordinal: 14, top: -200, height: 360, stem: "previous stem", clippedTop: true });
    createImageQuestionFixture({ id: "next", top: 164, height: 740, stem: "next partial question stem without an ordinal", clippedBottom: true });
    const blocks = detectCandidatesInViewport();
    expect(blocks.every((block) => !(block.previewText.includes("previous stem") && block.previewText.includes("next partial question")))).toBe(true);
  });

  it("does_not_cross_question_boundary_when_next_question_number_is_not_visible", () => {
    createImageQuestionFixture({ id: "tail", ordinal: 20, top: -130, height: 250, stem: "tail fragment", clippedTop: true, options: ["C. tail", "D. tail"] });
    createImageQuestionFixture({ id: "next-stem", top: 130, height: 760, stem: "a very similar next question stem?", clippedBottom: true });
    const blocks = detectCandidatesInViewport();
    expect(blocks.every((block) => !(block.previewText.includes("tail fragment") && block.previewText.includes("very similar next")))).toBe(true);
  });

  it("does_not_merge_nearby_complete_questions_with_similar_stems_and_options", () => {
    createImageQuestionFixture({ id: "q31", ordinal: 31, top: 40, height: 260, stem: "Which similar value is correct?", options: ["A. alpha", "B. beta", "C. gamma", "D. delta"] });
    createImageQuestionFixture({ id: "q32", ordinal: 32, top: 310, height: 260, stem: "Which similar value is correct?", options: ["A. alpha", "B. beta", "C. theta", "D. delta"] });
    const blocks = detectCandidatesInViewport();
    expect(blocks.filter((block) => /3[12]\. single choice/.test(block.previewText))).toHaveLength(2);
  });

  it("does_not_promote_or_merge_a_question_only_marginally_visible_at_the_viewport_bottom", () => {
    createImageQuestionFixture({ id: "complete", ordinal: 40, top: 40, height: 320, stem: "complete visible question?" });
    createImageQuestionFixture({ id: "bottom-tail", ordinal: 41, top: 870, height: 300, stem: "bottom tail should not be complete", clippedBottom: true });
    const blocks = detectCandidatesInViewport();
    expect(blocks.some((block) => block.previewText.includes("bottom tail should not be complete"))).toBe(false);
    expect(blocks.every((block) => !(block.previewText.includes("complete visible") && block.previewText.includes("bottom tail")))).toBe(true);
  });

  it("characterizes current limitation: an unlabelled question image becomes a placeholder in readable text", () => {
    const image = document.createElement("img");
    image.src = "https://example.com/figure.png";
    setElementRect(image, { left: 40, top: 40, width: 360, height: 220 });
    document.body.append(image);
    expect(extractReadableQuestionNodeText(image, readableTextDeps)).toBe("[图片]");
  });

  it("preserves a primary question image URL while structured display segments retain both images", () => {
    createImageQuestionFixture({ id: "multi-image", ordinal: 4, top: 40, stem: "Read both diagrams?", images: [
      { src: "https://example.com/small.png", width: 200, height: 100 },
      { src: "https://example.com/large.png", width: 400, height: 220 },
    ] });
    const block = detectCandidatesInViewport().find((candidate) => candidate.previewText.includes("Read both diagrams"))!;
    expect(block.hasImage).toBe(true);
    expect(block.questionImageUrl).toBe("https://example.com/large.png");
    expect(block.displaySegments?.filter((segment) => segment.type === "image")).toHaveLength(2);
  });

  it("characterizes CURRENT_LIMITATION_OPTION_IMAGE_OWNERSHIP", () => {
    createOptionImageQuestionFixture("option-images", 40);
    const block = detectCandidatesInViewport().find((candidate) => candidate.previewText.includes("Which image is correct"))!;
    expect(block.hasImage).toBe(true);
    expect(block.questionImageUrl).toBe("https://example.com/a.png");
    expect(block.displaySegments?.filter((segment) => segment.type === "image")).toHaveLength(0);
  });

  it("characterizes CURRENT_LIMITATION_DATA_URL_MEDIA", () => {
    const host = createImageQuestionFixture({ id: "data-image", ordinal: 5, top: 40, stem: "Use this image?", images: [{ src: "data:image/png;base64,AAAA", width: 300, height: 180 }] });
    const image = host.querySelector("img")!;
    expect(extractReadableQuestionNodeText(image, readableTextDeps)).toBe("[图片]");
    expect(pickQuestionImageFromElement(host)).toBeNull();
    const block = detectCandidatesInViewport().find((candidate) => candidate.previewText.includes("Use this image"))!;
    expect(block.hasImage).toBe(true);
    expect(block.questionImageUrl).toBeUndefined();
    expect(block.displaySegments?.some((segment) => segment.type === "image" && segment.url.startsWith("data:image/"))).toBe(true);
  });

  it("characterizes CURRENT_LIMITATION_CANVAS_MEDIA", () => {
    const host = createImageQuestionFixture({ id: "canvas-question", ordinal: 6, top: 40, stem: "Inspect the canvas?" });
    const canvas = document.createElement("canvas");
    host.querySelector(".questionContent")!.append(canvas);
    setElementRect(canvas, { left: 100, top: 110, width: 320, height: 180 });
    expect(hasMeaningfulVisualContent(host)).toBe(true);
    expect(extractReadableQuestionNodeText(canvas, readableTextDeps)).toBe("[图形]");
    const block = detectCandidatesInViewport().find((candidate) => candidate.previewText.includes("Inspect the canvas"))!;
    expect(block.hasImage).toBe(true);
    expect(block.questionImageUrl).toBeUndefined();
  });

  it("characterizes current limitation: question id changes after rerender while text fingerprint is stable", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(101).mockReturnValueOnce(202);
    const build = () => createImageQuestionFixture({ id: "rerender", ordinal: 9, top: 40, stem: "rerendered question?" });
    build();
    const first = detectCandidatesInViewport()[0];
    document.body.innerHTML = "";
    build();
    const second = detectCandidatesInViewport()[0];
    expect(first.id).not.toBe(second.id);
    expect(getAutoSolveTextFingerprint(first.previewText)).toBe(getAutoSolveTextFingerprint(second.previewText));
    expect(getAutoSolveFingerprint(first)).not.toBe(getAutoSolveFingerprint(second));
  });
});
