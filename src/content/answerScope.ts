import type { BoundingBox, ParseResult, QuestionBlock } from "@/shared/types";
import {
  getScrollLeft,
  getScrollTop,
  resolveFullPageScrollRoot,
  setScrollPosition,
  type ScanScrollRoot,
} from "./detector/fullPageDetector";
import {
  compareRectPosition,
  intersectionArea,
  isExtensionUiElement,
  isVisible,
  pause,
  rectIntersectsExpandedBBox,
} from "./answerDomUtils";

const QUESTION_SCOPE_SELECTOR = ".question-item,.base-question-component,.questionBox,.q-detail,.card";

export function resolveQuestionScope(
  bbox: BoundingBox,
  selectors: { textInputSelector: string; choiceInputSelector: string },
): Element {
  const structuredScope = findBestStructuredQuestionScope(bbox, selectors);
  if (structuredScope) return structuredScope;

  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const stack = document.elementsFromPoint(cx, cy);
  const anchor = stack.find((el) => !isExtensionUiElement(el)) || document.body;
  const explicitScope = anchor.closest?.(QUESTION_SCOPE_SELECTOR);
  if (explicitScope instanceof HTMLElement && !isExtensionUiElement(explicitScope)) {
    return explicitScope;
  }

  let best: Element = anchor;
  let bestScore = Number.NEGATIVE_INFINITY;
  let node: Element | null = anchor;

  for (let depth = 0; depth < 12 && node; depth += 1) {
    if (isExtensionUiElement(node)) {
      node = node.parentElement;
      continue;
    }

    const rect = node.getBoundingClientRect();
    const inter = intersectionArea(rect, bbox);
    if (inter <= 0) {
      node = node.parentElement;
      continue;
    }

    const textCount = node.querySelectorAll(selectors.textInputSelector).length;
    const choiceCount = node.querySelectorAll(selectors.choiceInputSelector).length;
    const area = Math.max(1, rect.width * rect.height);
    const bboxArea = Math.max(1, bbox.width * bbox.height);
    const overlapRatio = inter / Math.min(area, bboxArea);
    const areaRatio = area / bboxArea;

    let score = overlapRatio * 100 + textCount * 15 + choiceCount * 12 - depth * 5;
    if (areaRatio > 10) score -= 80;
    if (areaRatio < 0.4) score -= 20;
    if (node === document.body || node === document.documentElement) score -= 200;

    if (score > bestScore) {
      best = node;
      bestScore = score;
    }

    node = node.parentElement;
  }

  return best;
}

export function shouldRelocateScope(scope: Element, block: QuestionBlock, result: ParseResult): boolean {
  const host = scope instanceof HTMLElement ? scope : null;
  if (!host) return false;
  if (host.matches(".question-item")) return false;
  const nestedQuestionCount = host.querySelectorAll(".question-item").length;
  if (nestedQuestionCount > 1) return true;

  const ordinal = extractQuestionOrdinal(block, result);
  if (!ordinal) return false;
  const orderedQuestionItems = getOrderedQuestionItems();
  const expectedScope = orderedQuestionItems[ordinal - 1];
  return Boolean(expectedScope && expectedScope !== host && !host.contains(expectedScope));
}

export async function resolveDirectQuestionScope(
  block: QuestionBlock,
  result: ParseResult,
): Promise<{ scope: Element; bbox: BoundingBox } | null> {
  const direct = resolveDirectQuestionScopeSync(block, result);
  if (!direct) return null;
  direct.scope.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
  await pause(60);
  return {
    scope: direct.scope,
    bbox: rectToBoundingBox((direct.scope as HTMLElement).getBoundingClientRect()),
  };
}

export function resolveDirectQuestionScopeSync(
  block: QuestionBlock,
  result: ParseResult,
): { scope: Element; bbox: BoundingBox } | null {
  const ordinal = extractQuestionOrdinal(block, result);
  const orderedQuestionItems = getOrderedQuestionItems();
  if (ordinal && ordinal >= 1 && ordinal <= orderedQuestionItems.length) {
    const scope = orderedQuestionItems[ordinal - 1];
    return {
      scope,
      bbox: rectToBoundingBox(scope.getBoundingClientRect()),
    };
  }

  return relocateQuestionScopeByTextSync(block, result);
}

export async function relocateQuestionScopeByText(
  block: QuestionBlock,
  result: ParseResult,
): Promise<{ scope: Element; bbox: BoundingBox } | null> {
  const relocated = relocateQuestionScopeByTextSync(block, result);
  if (!relocated) return null;
  relocated.scope.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
  await pause(60);
  return {
    scope: relocated.scope,
    bbox: rectToBoundingBox(relocated.scope.getBoundingClientRect()),
  };
}

export function relocateQuestionScopeByTextSync(
  block: QuestionBlock,
  result: ParseResult,
): { scope: Element; bbox: BoundingBox } | null {
  const scopes = Array.from(document.querySelectorAll(QUESTION_SCOPE_SELECTOR))
    .filter((el): el is HTMLElement => el instanceof HTMLElement && !isExtensionUiElement(el));
  if (!scopes.length) return null;

  const needles = buildQuestionLookupNeedles(block, result);
  if (!needles.length) return null;

  const ordinal = extractQuestionOrdinal(block, result);
  if (ordinal) {
    const orderedQuestionItems = getOrderedQuestionItems();
    const ordinalScope = orderedQuestionItems[ordinal - 1];
    if (ordinalScope) {
      const haystack = normalizeLookupText(ordinalScope.innerText || ordinalScope.textContent || "");
      if (haystack && needles.some((needle) => haystack.includes(needle) || needle.includes(haystack))) {
        return {
          scope: ordinalScope,
          bbox: rectToBoundingBox(ordinalScope.getBoundingClientRect()),
        };
      }
    }
  }

  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const scope of scopes) {
    const haystack = normalizeLookupText(scope.innerText || scope.textContent || "");
    if (!haystack) continue;

    let score = 0;
    for (const needle of needles) {
      if (!needle) continue;
      if (haystack.includes(needle)) {
        score = Math.max(score, 300 + Math.min(needle.length, 220));
        continue;
      }
      if (needle.includes(haystack) && haystack.length >= 32) {
        score = Math.max(score, 180 + Math.min(haystack.length, 180));
      }
    }

    if (score > bestScore) {
      best = scope;
      bestScore = score;
    }
  }

  if (!best || bestScore < 220) return null;
  return {
    scope: best,
    bbox: rectToBoundingBox(best.getBoundingClientRect()),
  };
}

export function normalizeBBoxToViewport(bbox: BoundingBox): BoundingBox {
  const scrollRoot = resolveFullPageScrollRoot();
  if (!looksLikeAbsoluteBBox(bbox, scrollRoot)) return bbox;

  if (scrollRoot === window) {
    return {
      x: bbox.x - window.scrollX,
      y: bbox.y - window.scrollY,
      width: bbox.width,
      height: bbox.height,
    };
  }

  const elementRoot = scrollRoot as HTMLElement;
  const rootRect = elementRoot.getBoundingClientRect();
  return {
    x: rootRect.left + bbox.x - getScrollLeft(elementRoot),
    y: rootRect.top + bbox.y - getScrollTop(elementRoot),
    width: bbox.width,
    height: bbox.height,
  };
}

export function ensureQuestionRegionVisible(bbox: BoundingBox): void {
  const scrollRoot = resolveFullPageScrollRoot();
  const absoluteTop = resolveAbsoluteTopInScrollRoot(bbox, scrollRoot);
  const absoluteBottom = absoluteTop + bbox.height;
  const viewTop = getScrollTop(scrollRoot);
  const viewBottom = viewTop + getScrollViewportHeight(scrollRoot);

  if (absoluteTop >= viewTop + 24 && absoluteBottom <= viewBottom - 24) return;

  const targetTop = Math.max(0, absoluteTop - Math.max(96, Math.floor(window.innerHeight * 0.18)));
  setScrollPosition(scrollRoot, targetTop, getScrollLeft(scrollRoot));
}

export function collectTextControls(scope: Element, bbox: BoundingBox, textInputSelector: string): HTMLElement[] {
  return Array.from(scope.querySelectorAll(textInputSelector))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((node) => isVisible(node))
    .filter((node) => rectIntersectsExpandedBBox(node.getBoundingClientRect(), bbox, 40, 320))
    .sort((a, b) => compareRectPosition(a.getBoundingClientRect(), b.getBoundingClientRect()));
}

function buildQuestionLookupNeedles(block: QuestionBlock, result: ParseResult): string[] {
  const rawSources = [
    String(block.previewText || ""),
    String(result.recognizedText || ""),
  ].filter(Boolean);

  const out = new Set<string>();
  for (const source of rawSources) {
    const normalized = normalizeLookupText(source);
    if (normalized.length >= 24) out.add(normalized);

    const stem = normalizeLookupText(source.split(/\bA[\.\):：、]\s*/i)[0] || "");
    if (stem.length >= 16) out.add(stem);

    const leading = normalizeLookupText(source.slice(0, 120));
    if (leading.length >= 20) out.add(leading);
  }
  return Array.from(out);
}

function extractQuestionOrdinal(block: QuestionBlock, result: ParseResult): number | null {
  const sources = [block.previewText, result.recognizedText]
    .map((text) => String(text || "").trim())
    .filter(Boolean);
  for (const source of sources) {
    const match = source.match(/^(\d{1,3})\s*[\.\)、\]]/);
    const value = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function findBestStructuredQuestionScope(
  bbox: BoundingBox,
  selectors: { textInputSelector: string; choiceInputSelector: string },
): Element | null {
  const scopeCandidates = Array.from(document.querySelectorAll(QUESTION_SCOPE_SELECTOR))
    .filter((el): el is HTMLElement => el instanceof HTMLElement && !isExtensionUiElement(el) && isVisible(el));

  let best: Element | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of scopeCandidates) {
    const rect = candidate.getBoundingClientRect();
    const inter = intersectionArea(rect, bbox);
    if (inter <= 0) continue;

    const area = Math.max(1, rect.width * rect.height);
    const bboxArea = Math.max(1, bbox.width * bbox.height);
    const overlapRatio = inter / Math.min(area, bboxArea);
    const areaRatio = area / bboxArea;
    const choiceLikeCount = candidate.querySelectorAll(`${selectors.choiceInputSelector},.option-item`).length;
    const textLikeCount = candidate.querySelectorAll(selectors.textInputSelector).length;

    let score = overlapRatio * 140 + choiceLikeCount * 6 + textLikeCount * 8;
    if (candidate.matches(".question-item,.questionBox")) score += 18;
    if (candidate.matches(".base-question-component")) score += 12;
    if (areaRatio > 8) score -= 40;
    if (areaRatio < 0.35) score -= 16;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= 24 ? best : null;
}

function normalizeLookupText(text: string): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/瀵瑰|閿欓敊/g, "")
    .replace(/[\s()[\]{}<>.,;:'"`~!@#$%^&*+=|\\/?:，。；：、】【（）《》“”‘’\u00A0-]+/g, "")
    .toLowerCase();
}

function rectToBoundingBox(rect: DOMRect): BoundingBox {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function looksLikeAbsoluteBBox(bbox: BoundingBox, scrollRoot: ScanScrollRoot): boolean {
  if (scrollRoot === window) {
    return (
      bbox.y > window.innerHeight + 32
      || bbox.x > window.innerWidth + 32
      || (window.scrollY > 0 && bbox.y > window.scrollY + 32)
      || (window.scrollX > 0 && bbox.x > window.scrollX + 32)
    );
  }

  const elementRoot = scrollRoot as HTMLElement;
  const rootRect = elementRoot.getBoundingClientRect();
  return (
    bbox.y > rootRect.bottom + 32
    || bbox.x > rootRect.right + 32
  );
}

function resolveAbsoluteTopInScrollRoot(bbox: BoundingBox, scrollRoot: ScanScrollRoot): number {
  if (looksLikeAbsoluteBBox(bbox, scrollRoot)) return bbox.y;
  if (scrollRoot === window) return bbox.y + window.scrollY;
  const elementRoot = scrollRoot as HTMLElement;
  const rootRect = elementRoot.getBoundingClientRect();
  return bbox.y - rootRect.top + getScrollTop(elementRoot);
}

function getScrollViewportHeight(scrollRoot: ScanScrollRoot): number {
  return scrollRoot === window ? window.innerHeight : (scrollRoot as HTMLElement).clientHeight;
}

function getOrderedQuestionItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".question-item"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement && !isExtensionUiElement(el));
}
