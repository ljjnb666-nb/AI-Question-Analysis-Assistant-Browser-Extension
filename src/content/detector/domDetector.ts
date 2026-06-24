/**
 * DOM Detector (rebuilt)
 * - Detects question candidates in viewport
 * - Watches SPA mutations
 * - Filters control-panel/navigation blocks
 */

import type { QuestionBlock, QuestionType, BoundingBox } from "@/shared/types";
import { logWarn } from "@/shared/utils/errorLogger";
import {
  refineBboxForDetectedType as refineBboxForDetectedTypeCore,
  refineCandidateRect as refineCandidateRectCore,
} from "./domCandidateGeometry";
import {
  containsMathLikeContent,
  extractReadableNodeText,
  extractStructuredQuestionDisplaySegments,
  extractStructuredQuestionText,
} from "./domStructuredText";
import {
  CIRCLED_RE,
  OPTION_RE,
  QUESTION_RE,
  countBlankMarkersInText,
  countOptionMarkersInText,
  hasStrongQuestionSignal,
  inferQuestionType,
  isJudgeLikeText,
  normalizeMathDisplayText,
  normalizeText,
  sanitizeChoicePreviewText,
  sanitizeJudgePreviewText,
  sanitizePreviewTextByType,
  stripSvgCssNoise,
} from "./domText";
import { bboxIntersectsRect, isExtensionUiElement, isLikelyActionText, isLikelyControlPanelText } from "./domDetectorShared";
import {
  completenessScore,
  deduplicateBlocks,
  filterFragmentBlocks,
  isLikelyCompleteQuestionText,
  mergeAdjacentQuestionBlocks,
} from "./domDetectorPostprocess";
import { buildPreviewText, buildPreviewTextForBbox, getElementReadableText } from "./domDetectorPreview";
import { hasMeaningfulVisualContent, pickQuestionImageFromElement } from "./domDetectorVisual";

let mutationObserver: MutationObserver | null = null;
let pendingRescan = false;
let onCandidatesChanged: ((blocks: QuestionBlock[]) => void) | null = null;

export function watchForPageChanges(callback: (blocks: QuestionBlock[]) => void): () => void {
  onCandidatesChanged = callback;

  mutationObserver?.disconnect();
  mutationObserver = new MutationObserver(() => {
    if (pendingRescan) return;
    pendingRescan = true;
    setTimeout(() => {
      pendingRescan = false;
      const blocks = detectCandidatesInViewport();
      if (blocks.length > 0) onCandidatesChanged?.(blocks);
    }, 800);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: false,
  });

  return () => {
    mutationObserver?.disconnect();
    mutationObserver = null;
    onCandidatesChanged = null;
  };
}

export function detectCandidatesInViewport(): QuestionBlock[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const viewportArea = Math.max(1, vw * vh);
  const hostRightCutX = getHostRightSidebarCutX(vw, vh);
  const stableQuestionCards = getStableQuestionCardContainers();
  const structuredContainers = detectStructuredQuestionContainers();
  const hasStructuredContainers = structuredContainers.length >= 1;

  const grouped = new Map<string, QuestionBlock>();
  const groupRank = new Map<string, number>();
  const groupIdMap = new WeakMap<Element, string>();
  let groupCounter = 0;

  const getGroupId = (el: Element): string => {
    const container = findQuestionContainer(el);
    if (!container) return `self-${(el as HTMLElement).tagName}`;
    const existing = groupIdMap.get(container);
    if (existing) return existing;
    const id = `g-${++groupCounter}`;
    groupIdMap.set(container, id);
    return id;
  };

  const directCardBodies = Array.from(document.querySelectorAll(".card.mb-3.q-detail.rounded-0 .card-body"));
  const preferDirectCardMode = directCardBodies.length >= 1;
  for (const [directIndex, el] of directCardBodies.entries()) {
    if (isExtensionUiElement(el)) continue;
    const structuredHost = el.querySelector(".question-item, .questionBox, .base-question-component");
    const rectSource = (structuredHost instanceof HTMLElement ? structuredHost : el) as HTMLElement;
    const rawRect = rectSource.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 80 || rect.height < 16) continue;

    const text = structuredHost
      ? extractStructuredQuestionText(structuredHost)
      : getElementReadableText(el);
    if (!text || text.length < 10) continue;
    if (isLikelyControlPanelText(text)) continue;

    let candidateBbox = applyRightCutToBbox(refineCandidateRect(rectSource, rect, vw, vh), hostRightCutX);
    let previewText = buildPreviewTextForBbox(el, candidateBbox, text);
    const guessed = inferQuestionType(previewText || text);
    candidateBbox = refineBboxForDetectedType(rectSource, candidateBbox, guessed, vw, vh);
    previewText = structuredHost
      ? sanitizePreviewTextByType(text, guessed)
      : sanitizePreviewTextByType(buildPreviewTextForBbox(el, candidateBbox, text), guessed);
    if (!isLikelyCompleteQuestionText(previewText, guessed)) continue;
    const candidate: QuestionBlock = {
      id: `auto-direct-${Date.now()}-${directIndex}-${Math.random().toString(36).slice(2, 8)}`,
      bbox: candidateBbox,
      previewText: previewText.slice(0, 420),
      displaySegments: structuredHost ? extractStructuredQuestionDisplaySegments(structuredHost) : undefined,
      hasImage: hasMeaningfulVisualContent(rectSource),
      questionImageUrl: pickQuestionImageFromElement(rectSource) ?? undefined,
      questionTypeGuess: guessed,
      confidence: 0.9,
      source: "auto_dom",
    };

    const gid = `direct-card-${directIndex}`;
    const rank = completenessScore(candidate.previewText, candidate.questionTypeGuess, candidate.confidence) + 20;
    const prev = groupRank.get(gid) ?? -Infinity;
    if (rank > prev) {
      groupRank.set(gid, rank);
      grouped.set(gid, candidate);
    }
  }

  if (!preferDirectCardMode) {
    const stableContainerBlocks = buildStableStructuredContainerCandidates(stableQuestionCards, hostRightCutX, vw, vh);
    if (stableContainerBlocks.length > 0) {
      return filterFragmentBlocks(deduplicateBlocks(stableContainerBlocks).sort((a, b) => a.bbox.y - b.bbox.y));
    }
  }

  const elements = collectCandidateElements();
  for (const el of elements) {
    if (preferDirectCardMode) break;
    if (isExtensionUiElement(el)) continue;
    if (hasStructuredContainers && !isInsideAnyContainer(el, structuredContainers)) continue;
    if (hasStructuredContainers && structuredContainers.some((container) => container !== el && el.contains(container))) continue;
    const rawRect = el.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 60 || rect.height < 16) continue;
    if (rect.width * rect.height > viewportArea * 0.75) continue;

    const text = getElementReadableText(el);
    if (!text || text.length < 8 || text.length > 2500) continue;
    if (isLikelyControlPanelText(text)) continue;
    if (isLikelyNavigationElement(el, text)) continue;
    const strongSignal = hasStrongQuestionSignal(text);
    const contextLike = isLikelyQuestionContext(el);
    if (!strongSignal && !contextLike) continue;

    const score = scoreElement(el, text);
    if (score.confidence < 0.35) continue;

    let candidateBbox = applyRightCutToBbox(refineCandidateRect(el, rect, vw, vh), hostRightCutX);
    let previewText = buildPreviewTextForBbox(el, candidateBbox, text);
    const previewType = inferQuestionType(previewText || text);
    const candidateType = previewType !== "unknown" ? previewType : score.type;
    candidateBbox = refineBboxForDetectedType(el, candidateBbox, candidateType, vw, vh);
    previewText = sanitizePreviewTextByType(buildPreviewTextForBbox(el, candidateBbox, text), candidateType);
    if (!isLikelyCompleteQuestionText(previewText, candidateType)) continue;

    const candidate: QuestionBlock = {
      id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bbox: candidateBbox,
      previewText: previewText.slice(0, 420),
      hasImage: score.hasImage,
      questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
      questionTypeGuess: candidateType,
      confidence: score.confidence,
      source: "auto_dom",
    };

    const gid = getGroupId(el);
    const rank = completenessScore(candidate.previewText, candidateType, score.confidence);
    const prev = groupRank.get(gid) ?? -Infinity;
    if (rank > prev) {
      groupRank.set(gid, rank);
      grouped.set(gid, candidate);
    }
  }

  const blocks = [...grouped.values()];

  // Hard isolation for card-structured pages:
  // when direct-card mode is active, return card candidates only.
  // This prevents cross-question merging/fragment filtering side-effects.
  if (preferDirectCardMode && blocks.length > 0) {
    return blocks.sort((a, b) => a.bbox.y - b.bbox.y);
  }

  try {
    blocks.push(...scanIframes(vw, vh));
  } catch (err) {
    logWarn("Failed to scan iframes", "detectCandidatesInViewport", { error: String(err) });
  }

  const merged = mergeAdjacentQuestionBlocks(deduplicateBlocks(blocks).sort((a, b) => a.bbox.y - b.bbox.y));
  return filterFragmentBlocks(merged);
}

function buildStableStructuredContainerCandidates(
  containers: Element[],
  hostRightCutX: number | null,
  vw: number,
  vh: number,
): QuestionBlock[] {
  if (!isPolymasOrZhihuishuHost()) return [];

  const out: QuestionBlock[] = [];
  const seen = new Set<Element>();
  let index = 0;
  for (const el of containers) {
    const hostContainer = el as Element;
    if (!(hostContainer instanceof HTMLElement)) continue;
    if (!hostContainer.matches(".question-item, .questionBox, .base-question-component")) continue;
    if (isExtensionUiElement(hostContainer)) continue;
    if (seen.has(hostContainer)) continue;
    seen.add(hostContainer);

    const rawRect = hostContainer.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 240 || rect.height < 120) continue;
    if (getVisibleVerticalRatio(rawRect, vh) < 0.55) continue;
    if (isTopClippedQuestionTail(hostContainer, rawRect, vh)) continue;

    const readableText = extractStructuredQuestionText(hostContainer);
    const displaySegments = extractStructuredQuestionDisplaySegments(hostContainer);
    const previewText = sanitizePreviewTextByType(readableText, inferQuestionType(readableText));
    const candidateType = inferQuestionType(previewText);
    if (!isLikelyCompleteQuestionText(previewText, candidateType)) continue;

    out.push({
      id: `auto-structured-${Date.now()}-${index++}`,
      bbox: clampRectToBbox(rect, vw, vh),
      previewText: previewText.slice(0, 420),
      displaySegments,
      hasImage: hasMeaningfulVisualContent(hostContainer) || !!hostContainer.querySelector("table"),
      questionImageUrl: pickQuestionImageFromElement(hostContainer) ?? undefined,
      questionTypeGuess: candidateType,
      confidence: 0.94,
      source: "auto_dom",
    });
  }

  return out;
}

function isTopClippedQuestionTail(container: HTMLElement, rect: DOMRect, vh: number): boolean {
  if (rect.top >= -24) return false;

  const titleNode = container.querySelector(".title-box,.questionTit,.question-title");
  if (titleNode instanceof HTMLElement) {
    const titleRect = titleNode.getBoundingClientRect();
    if (titleRect.height >= 8 && titleRect.width >= 20) {
      // Current-screen detection should not keep the previous question
      // once the question title itself has scrolled out of the viewport.
      if (titleRect.bottom <= 20) return true;
      if (titleRect.bottom > 20 && titleRect.top < vh - 16) return false;
    }
  }

  const stemNode = container.querySelector(
    ".qeustion-content,.questionContent,.question-content,.stem,.question-body,.content",
  );
  if (stemNode instanceof HTMLElement) {
    const stemRect = stemNode.getBoundingClientRect();
    if (stemRect.height >= 8 && stemRect.width >= 20) {
      if (stemRect.bottom <= 24) return true;
      if (stemRect.top >= 20 && stemRect.top < vh - 16) return false;
    }
  }

  return rect.top < -48;
}

function getStableQuestionCardContainers(): Element[] {
  const preferredSelectors = [
    ".question-item",
    ".questionBox",
    ".base-question-component",
  ];
  const seen = new Set<Element>();
  const out: Element[] = [];

  for (const selector of preferredSelectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (seen.has(node) || isExtensionUiElement(node)) continue;
      if (!isElementVisible(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 240 || rect.height < 120) continue;
      seen.add(node);
      out.push(node);
    }
  }

  return out.filter((el) => {
    if (el.matches(".question-item, .questionBox")) return true;
    const host = el.closest(".question-item, .questionBox");
    return !host;
  });
}

function scanIframes(vw: number, vh: number): QuestionBlock[] {
  const blocks: QuestionBlock[] = [];
  const iframes = document.querySelectorAll("iframe");
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) continue;
      const frameRect = iframe.getBoundingClientRect();
      if (!inViewport(frameRect, vw, vh)) continue;

      const els = doc.querySelectorAll("p,div,li,section,article");
      for (const el of els) {
        const text = normalizeText(el.textContent ?? "");
        if (!text || text.length < 12 || isLikelyControlPanelText(text)) continue;

        const score = scoreElement(el, text);
        if (score.confidence < 0.45) continue;

        const r = (el as HTMLElement).getBoundingClientRect();
        blocks.push({
          id: `iframe-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          bbox: {
            x: Math.max(0, frameRect.left + r.left),
            y: Math.max(0, frameRect.top + r.top),
            width: Math.min(r.width, vw),
            height: Math.min(r.height, vh),
          },
          previewText: buildPreviewText(el, text).slice(0, 420),
          hasImage: score.hasImage,
          questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
          questionTypeGuess: score.type,
          confidence: score.confidence * 0.9,
          source: "auto_dom",
        });
      }
    } catch (err) {
      logWarn("Failed to scan iframe content", "scanIframes", { error: String(err) });
    }
  }
  return blocks;
}

function scoreElement(el: Element, text: string): { confidence: number; type: QuestionType; hasImage: boolean } {
  let confidence = 0;
  let type: QuestionType = "unknown";
  let hasImage = false;

  const pageIsJudge = /typeid=600079/i.test(window.location.search);
  const optionCount = countOptionMarkersInText(text);
  const blankControlCount = countBlankControls(el);
  const blankMarkerCount = countBlankMarkersInText(text);
  const judgeControlCount = countJudgeControls(el);

  if (/^(\d{1,3})[\.、。\)）]\s*/.test(text) || /^第\s*\d{1,3}\s*题/.test(text)) confidence += 0.35;

  if (optionCount >= 2) {
    confidence += 0.25 + Math.min(optionCount * 0.04, 0.18);
    type = optionCount >= 4 ? "single_choice" : "multi_choice";
  }

  if (el.matches(".card-body") && el.closest(".q-detail")) {
    confidence += 0.35;
    if (type === "unknown") type = inferQuestionType(text);
  }

  if (isJudgeLikeText(text)) {
    confidence += 0.3;
    type = "judge";
  } else if (judgeControlCount >= 2) {
    confidence += 0.28 + Math.min(judgeControlCount * 0.04, 0.12);
    if (type === "unknown") type = "judge";
  } else if (pageIsJudge && type === "unknown") {
    const looksLikeJudgeStatement = text.length >= 10 && text.length <= 220 && /[。！？.!?)]$/.test(text);
    if (looksLikeJudgeStatement) {
      confidence += 0.25;
      type = "judge";
    }
  }

  if (/(?:_{3,}|[（(]\s{3,}[)）]|填写|blank)/i.test(text)) {
    confidence += 0.2;
    if (type === "unknown") type = "fill_blank";
  }
  if (blankControlCount > 0 || blankMarkerCount >= 2) {
    confidence += 0.28 + Math.min(blankControlCount * 0.06, 0.18);
    if (type === "unknown" || type === "short_answer") type = "fill_blank";
  }

  if (/简述|说明|解释|分析|列举/.test(text) && text.length > 30) {
    confidence += 0.15;
    if (type === "unknown") type = "short_answer";
  }

  if (hasMeaningfulVisualContent(el)) {
    hasImage = true;
    confidence += 0.1;
  }
  if (containsMathLikeContent(el, text)) {
    confidence += 0.04;
  }

  if (text.includes("?") || text.includes("？")) confidence += 0.05;
  if (text.length < 20) confidence *= 0.5;

  const tag = el.tagName.toLowerCase();
  if (["nav", "header", "footer", "aside", "script", "style"].includes(tag)) confidence *= 0.1;

  return { confidence: Math.min(confidence, 1), type, hasImage };
}

function countBlankControls(el: Element): number {
  return el.querySelectorAll("input:not([type='radio']):not([type='checkbox']):not([type='hidden']):not([type='button']):not([type='submit']),textarea,[contenteditable='true']").length;
}

function countJudgeControls(el: Element): number {
  const controlCount = el.querySelectorAll("input[type='radio'],input[type='checkbox']").length;
  const judgeWordCount = (normalizeText(el.textContent || "").match(/(?:对|错|正确|错误|true|false|t\/f)/gi) || []).length;
  return controlCount + Math.min(judgeWordCount, 2);
}

function isLikelyQuestionContext(el: Element): boolean {
  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i++) {
    const cls = String((node as HTMLElement).className || "").toLowerCase();
    const id = String((node as HTMLElement).id || "").toLowerCase();
    const marker = `${cls} ${id}`;
    const positive = /(q-detail|question|problem|stem|exam|quiz|test|subject|card)/.test(marker);
    const negative = /(nav|menu|toolbar|filter|search|chapter|catalog|sidebar|aside|header|footer|breadcrumb|selector)/.test(marker);
    if (positive && !negative) return true;
    node = node.parentElement;
  }
  return false;
}

function isLikelyNavigationElement(el: Element, text: string): boolean {
  const tag = el.tagName.toLowerCase();
  if (["nav", "header", "footer", "aside"].includes(tag)) return true;
  const linkCount = el.querySelectorAll("a").length;
  if (linkCount >= 6 && !hasStrongQuestionSignal(text)) return true;
  return false;
}

function isElementVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null) return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (style.opacity === "0") return false;
  return true;
}

function isInsideAnyContainer(el: Element, containers: Element[]): boolean {
  for (const c of containers) {
    if (c.contains(el)) return true;
  }
  return false;
}

function detectStructuredQuestionContainers(): Element[] {
  const selectors = [
    ".Classificationquestionall-div .questionBox",
    ".questionBox",
    ".question-item",
    ".base-question-component",
    ".card.mb-3.q-detail.rounded-0",
    ".q-detail",
    ".problem-item",
    ".exam-item",
    ".test-item",
    ".card",
    "article",
    "section",
  ];
  const out: Element[] = [];
  const seen = new Set<Element>();

  for (const sel of selectors) {
    let list: NodeListOf<Element>;
    try {
      list = document.querySelectorAll(sel);
    } catch {
      continue;
    }
    for (const el of list) {
      if (seen.has(el)) continue;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width < 120 || rect.height < 80) continue;
      const text = getElementReadableText(el);
      if (text.length < 28) continue;
      const bodyLike = el.querySelector(".card-body,.question-body,.stem,article,section");
      const footerLike = el.querySelector(".card-footer,.question-footer,.actions,.tools");
      const hasQuestionSignal = hasStrongQuestionSignal(text);
      const hasStructure = !!bodyLike || !!footerLike;
      if (!hasQuestionSignal && !hasStructure) continue;
      seen.add(el);
      out.push(el);
    }
  }

  // Prefer leaf-most containers so outer page shells do not become candidates.
  return out.filter((el) => !out.some((other) => other !== el && el.contains(other)));
}

function collectCandidateElements(): Element[] {
  const selectors = [
    ".Classificationquestionall-div .questionBox",
    ".questionBox",
    ".question-item",
    ".base-question-component",
    ".questionTit",
    ".qeustion-content",
    ".questionContent",
    ".optionUl",
    ".card.mb-3.q-detail.rounded-0 .card-body",
    ".q-detail .card-body",
    "p", "div", "li", "section", "article", "blockquote",
    "[class*='question']", "[class*='problem']", "[class*='item']", "[class*='stem']",
    "[class*='quiz']", "[class*='exam']", "[class*='test']", "[id*='question']",
  ];

  const seen = new Set<Element>();
  const out: Element[] = [];
  for (const sel of selectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        out.push(el);
      });
    } catch (err) {
      logWarn("Invalid selector", "collectCandidateElements", { selector: sel, error: String(err) });
    }
  }
  return out;
}

function findQuestionContainer(el: Element): Element | null {
  const isLeafQuestionPart = (node: Element): boolean => {
    const cls = String((node as HTMLElement).className || "").toLowerCase();
    const id = String((node as HTMLElement).id || "").toLowerCase();
    const marker = `${cls} ${id}`;
    return /(questiontit|questioncontent|optionul|option-li|option-item|stem|title|content|option)/.test(marker);
  };

  let best: Element | null = null;
  let bestScore = -Infinity;
  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i++) {
    const cls = String((node as HTMLElement).className || "").toLowerCase();
    const id = String((node as HTMLElement).id || "").toLowerCase();
    const marker = `${cls} ${id}`;
    const positive = /(q-detail|questionbox|question-box|question-item|base-question-component|problem-item|exam-item|test-item|question|problem|exercise|item|card|subject)/.test(marker);
    const negative = /(optionul|option-li|option-item|questioncontent|questiontit|toolbar|header|footer|sidebar|aside|nav)/.test(marker);
    if (positive && !negative) {
      let score = 0;
      if (/questionbox|question-box|q-detail|question-item|base-question-component|problem-item|exam-item|test-item/.test(marker)) score += 60;
      if (/card-body|card/.test(marker)) score += 35;
      if (cls.includes("question") || id.includes("question")) score += 20;
      if (cls.includes("item")) score += 12;
      if (node === el) score -= 18;
      if (isLeafQuestionPart(node)) score -= 40;
      score -= i * 3;
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    node = node.parentElement;
  }
  return best ?? el.parentElement;
}

function inViewport(rect: DOMRect, vw: number, vh: number): boolean {
  if (rect.bottom < 0 || rect.top > vh) return false;
  if (rect.right < 0 || rect.left > vw) return false;
  return true;
}

function clampRect(rect: DOMRect, vw: number, vh: number): BoundingBox {
  return {
    x: Math.max(0, rect.left),
    y: Math.max(0, rect.top),
    width: Math.min(rect.width, vw - rect.left),
    height: Math.min(rect.height, vh - rect.top),
  };
}

function clampRectToBbox(rect: DOMRect, vw: number, vh: number): BoundingBox {
  return clampRect(rect, vw, vh);
}

function getVisibleVerticalRatio(rect: DOMRect, vh: number): number {
  if (rect.height <= 1) return 0;
  const visibleTop = Math.max(0, rect.top);
  const visibleBottom = Math.min(vh, rect.bottom);
  return Math.max(0, visibleBottom - visibleTop) / rect.height;
}

function refineCandidateRect(el: Element, baseRect: DOMRect, vw: number, vh: number): BoundingBox {
  return refineCandidateRectCore(el, baseRect, vw, vh, {
    bboxIntersectsRect,
    clampRect,
    inViewport,
    isExtensionUiElement,
  });
}

function refineBboxForDetectedType(
  el: Element,
  bbox: BoundingBox,
  type: QuestionType,
  vw: number,
  vh: number,
): BoundingBox {
  return refineBboxForDetectedTypeCore(el, bbox, type, vw, vh, {
    bboxIntersectsRect,
    clampRect,
    inViewport,
    isExtensionUiElement,
  });
}

function isPolymasOrZhihuishuHost(): boolean {
  const host = (window.location.hostname || "").toLowerCase();
  return host.includes("polymas.com") || host.includes("zhihuishu.com");
}

function getHostRightSidebarCutX(vw: number, vh: number): number | null {
  if (!isPolymasOrZhihuishuHost()) return null;
  const nodes = Array.from(document.querySelectorAll("div,section,aside,article"));
  let cutX = Number.POSITIVE_INFINITY;

  for (const n of nodes) {
    if (!(n instanceof HTMLElement)) continue;
    if (isExtensionUiElement(n)) continue;
    const rect = n.getBoundingClientRect();
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.left < vw * 0.45) continue;
    if (rect.width < 140 || rect.height < 90) continue;
    const text = normalizeText(n.innerText || n.textContent || "");
    if (!text || text.length > 800) continue;

    const isAnswerCard = /答题卡/.test(text);
    const isScorePanel = /总分/.test(text) && /题目数/.test(text);
    const isDeadlinePanel = /截止时间/.test(text) && /题目数/.test(text);
    if (isAnswerCard || isScorePanel || isDeadlinePanel) {
      cutX = Math.min(cutX, rect.left);
    }
  }

  return Number.isFinite(cutX) ? cutX : null;
}

function applyRightCutToRect(rect: DOMRect, cutX: number | null): DOMRect | null {
  if (!Number.isFinite(cutX as number)) return rect;
  const rightLimit = (cutX as number) - 10;
  if (rect.left >= rightLimit) return null;
  if (rect.right <= rightLimit) return rect;
  const w = Math.max(10, rightLimit - rect.left);
  return new DOMRect(rect.left, rect.top, w, rect.height);
}

function applyRightCutToBbox(bbox: BoundingBox, cutX: number | null): BoundingBox {
  if (!Number.isFinite(cutX as number)) return bbox;
  const rightLimit = (cutX as number) - 10;
  const right = bbox.x + bbox.width;
  if (right <= rightLimit) return bbox;
  const width = Math.max(10, rightLimit - bbox.x);
  return { ...bbox, width };
}
