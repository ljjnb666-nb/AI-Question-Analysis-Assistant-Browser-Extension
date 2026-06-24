import type { BoundingBox, QuestionBlock } from "@/shared/types";
import { detectCandidatesInViewport } from "./detector/domDetector";
import {
  detectTotalQuestionCount as detectTotalQuestionCountCore,
  extractSelectedChoiceAnswer as extractSelectedChoiceAnswerCore,
  hasVisibleAutoSolveMedia as hasVisibleAutoSolveMediaCore,
  inspectAutoSolveAnswerState as inspectAutoSolveAnswerStateCore,
} from "./autoSolveDomState";
import { findBestDetectedCandidateForBBox as findBestDetectedCandidateForBBoxCore, findLikelyQuestionBBoxNear as findLikelyQuestionBBoxNearCore, findStrictQuestionCardBBox as findStrictQuestionCardBBoxCore, looksLikeNavigationText as looksLikeNavigationTextCore, refineManualBBoxToQuestionContainer as refineManualBBoxToQuestionContainerCore, resolveQuestionBlockFromBBox as resolveQuestionBlockFromBBoxCore } from "./questionBlockResolution";
import { extractQuestionImageUrlFromBBox as extractQuestionImageUrlFromBBoxCore, extractTextFromAnchoredContainer as extractTextFromAnchoredContainerCore, extractTextFromBBox as extractTextFromBBoxCore, findBestQuestionContainer as findBestQuestionContainerCore, pickAnchorElement as pickAnchorElementCore } from "./questionScope";
import { collectTextFromContainer as collectTextFromContainerCore, collectTextFromRegion as collectTextFromRegionCore, extractReadableQuestionNodeText as extractReadableQuestionNodeTextCore, extractRichQuestionPreviewFromElement as extractRichQuestionPreviewFromElementCore, hasLikelyMultipleQuestionStarts as hasLikelyMultipleQuestionStartsCore, intersectionArea as intersectionAreaCore, isDecorativeQuestionImage as isDecorativeQuestionImageCore, isElementVisible as isElementVisibleCore, isExtensionUiElement as isExtensionUiElementCore, normalizeQuestionText as normalizeQuestionTextCore, scoreQuestionLikeText as scoreQuestionLikeTextCore } from "./questionText";
import { findNearbySemanticFormulaTextForImage } from "./formulaEmbedFallback";

const richPreviewDeps = {
  extractReadableQuestionNodeText,
  isExtensionUiElement,
  normalizeQuestionText,
};

const containerTextDeps = {
  extractReadableQuestionNodeText,
  intersectionArea,
  isElementVisible,
  isExtensionUiElement,
};

const questionScopeDeps = {
  extractRichQuestionPreviewFromElement,
  intersectionArea,
  isExtensionUiElement,
};

const anchoredQuestionScopeDeps = {
  findBestQuestionContainer,
  normalizeQuestionText,
  pickAnchorElement,
};

const bboxTextDeps = {
  collectTextFromRegion,
  extractRichQuestionPreviewFromElement,
  extractTextFromAnchoredContainer,
  isExtensionUiElement,
  scoreQuestionLikeText,
};

const questionImageDeps = {
  findBestQuestionContainer,
  findNearbySemanticFormulaTextForImage,
  intersectionArea,
  isDecorativeQuestionImage,
  isElementVisible,
  pickAnchorElement,
};

const questionBlockResolutionDeps = {
  detectCandidatesInViewport,
  extractRichQuestionPreviewFromElement,
  extractTextFromBBox,
  findBestDetectedCandidateForBBox,
  findBestQuestionContainer,
  findStrictQuestionCardBBox,
  hasLikelyMultipleQuestionStarts,
  intersectionArea,
  isElementVisible,
  isExtensionUiElement,
  pickAnchorElement,
};

const nearbyQuestionBBoxDeps = {
  detectCandidatesInViewport,
  extractRichQuestionPreviewFromElement,
  extractTextFromBBox,
  findStrictQuestionCardBBox,
  intersectionArea,
  isElementVisible,
  isExtensionUiElement,
};

const detectedCandidateMatchDeps = {
  detectCandidatesInViewport,
  intersectionArea,
};

export function resolveQuestionBlockFromBBox(bbox: BoundingBox): {
  refinedBBox: BoundingBox;
  finalBBox: BoundingBox;
  previewText: string;
  matchedCandidate: QuestionBlock | null;
} {
  return resolveQuestionBlockFromBBoxCore(bbox, {
    detectCandidatesInViewport,
    extractRichQuestionPreviewFromElement,
    extractTextFromBBox,
    findBestDetectedCandidateForBBox,
    findLikelyQuestionBBoxNear,
    intersectionArea,
    isElementVisible,
    isExtensionUiElement,
    looksLikeNavigationText,
    refineManualBBoxToQuestionContainer,
  });
}

export function hasVisibleAutoSolveMedia(scope: Element): boolean {
  return hasVisibleAutoSolveMediaCore(scope, {
    isDecorativeQuestionImage,
    isElementVisible,
  });
}

export function detectTotalQuestionCount(): number {
  return detectTotalQuestionCountCore({
    isElementVisible,
    isExtensionUiElement,
    normalizeQuestionText,
  });
}

export function inspectAutoSolveAnswerState(block: QuestionBlock): {
  mode: "choice" | "text" | "none";
  answeredCount: number;
  totalCount: number;
  complete: boolean;
} {
  return inspectAutoSolveAnswerStateCore(block, anchoredQuestionScopeDeps);
}

export function extractSelectedChoiceAnswer(block: QuestionBlock): string {
  return extractSelectedChoiceAnswerCore(block, anchoredQuestionScopeDeps);
}

export function extractTextFromBBox(bbox: BoundingBox): string {
  return extractTextFromBBoxCore(bbox, bboxTextDeps);
}

export function extractQuestionImageUrlFromBBox(bbox: BoundingBox): string | null {
  return extractQuestionImageUrlFromBBoxCore(bbox, questionImageDeps);
}

export function extractTextFromAnchoredContainer(bbox: BoundingBox): string {
  return extractTextFromAnchoredContainerCore(bbox, {
    collectTextFromContainer,
    ...anchoredQuestionScopeDeps,
  });
}

export function pickAnchorElement(bbox: BoundingBox): Element | null {
  return pickAnchorElementCore(bbox, isExtensionUiElement);
}

export function findBestQuestionContainer(anchor: Element, bbox: BoundingBox): Element | null {
  return findBestQuestionContainerCore(anchor, bbox, questionScopeDeps);
}

export function refineManualBBoxToQuestionContainer(bbox: BoundingBox): BoundingBox {
  return refineManualBBoxToQuestionContainerCore(bbox, questionBlockResolutionDeps);
}

export function findStrictQuestionCardBBox(bbox: BoundingBox): BoundingBox | null {
  return findStrictQuestionCardBBoxCore(bbox, {
    intersectionArea,
    isElementVisible,
  });
}

export function looksLikeNavigationText(text: string): boolean {
  return looksLikeNavigationTextCore(text);
}

export function findLikelyQuestionBBoxNear(bbox: BoundingBox): BoundingBox | null {
  return findLikelyQuestionBBoxNearCore(bbox, nearbyQuestionBBoxDeps);
}

export function findBestDetectedCandidateForBBox(bbox: BoundingBox): QuestionBlock | null {
  return findBestDetectedCandidateForBBoxCore(bbox, detectedCandidateMatchDeps);
}

export function extractReadableQuestionNodeText(node: Element): string {
  return extractReadableQuestionNodeTextCore(node, richPreviewDeps);
}

export function extractRichQuestionPreviewFromElement(node: Element): string {
  return extractRichQuestionPreviewFromElementCore(node, {
    collectTextFromContainer,
    ...richPreviewDeps,
  });
}

export function intersectionArea(rect: DOMRect, bbox: BoundingBox): number {
  return intersectionAreaCore(rect, bbox);
}

export function isDecorativeQuestionImage(img: Element): boolean {
  return isDecorativeQuestionImageCore(img);
}

export function isElementVisible(el: HTMLElement): boolean {
  return isElementVisibleCore(el);
}

export function isExtensionUiElement(el: Element): boolean {
  return isExtensionUiElementCore(el);
}

export function normalizeQuestionText(raw: string): string {
  return normalizeQuestionTextCore(raw);
}

export function hasLikelyMultipleQuestionStarts(text: string): boolean {
  return hasLikelyMultipleQuestionStartsCore(text);
}

export function scoreQuestionLikeText(text: string, node: Element, depth: number): number {
  return scoreQuestionLikeTextCore(text, node, depth);
}

export function collectTextFromContainer(container: Element, bbox: BoundingBox): string {
  return collectTextFromContainerCore(container, bbox, containerTextDeps);
}

export function collectTextFromRegion(bbox: BoundingBox): string {
  return collectTextFromRegionCore(bbox, containerTextDeps);
}
