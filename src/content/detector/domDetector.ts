/**
 * DOM Detector (rebuilt)
 * - Detects question candidates in viewport
 * - Watches SPA mutations
 * - Filters control-panel/navigation blocks
 */

import type { QuestionBlock, QuestionType, BoundingBox, QuestionDisplaySegment } from "@/shared/types";
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
  CIRCLED_RE as _CIRCLED_RE,
  OPTION_RE as _OPTION_RE,
  QUESTION_RE as _QUESTION_RE,
  countBlankMarkersInText,
  countOptionMarkersInText,
  hasStrongQuestionSignal,
  inferQuestionType,
  isJudgeLikeText,
  normalizeMathDisplayText as _normalizeMathDisplayText,
  normalizeText,
  sanitizeChoicePreviewText as _sanitizeChoicePreviewText,
  sanitizeJudgePreviewText as _sanitizeJudgePreviewText,
  sanitizePreviewTextByType,
  stripSvgCssNoise as _stripSvgCssNoise,
} from "./domText";
import { bboxIntersectsRect, isExtensionUiElement, isLikelyActionText as _isLikelyActionText, isLikelyControlPanelText } from "./domDetectorShared";
import {
  completenessScore,
  deduplicateBlocks,
  filterFragmentBlocks,
  isLikelyCompleteQuestionText,
  mergeAdjacentQuestionBlocks,
} from "./domDetectorPostprocess";
import { buildPreviewText, buildPreviewTextForBbox, getElementReadableText } from "./domDetectorPreview";
import { hasMeaningfulVisualContent, pickQuestionImageFromElement } from "./domDetectorVisual";
import { attachQuestionIdentity } from "../questionIdentity";

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
  const pintiaQuestionListBlocks = isPintiaQuestionListPage()
    ? buildPintiaQuestionListCandidates(hostRightCutX, vw, vh)
    : [];
  const pintiaCodeProblemBlocks = isPintiaCodeProblemStatementPage()
    ? buildPintiaCodeProblemCandidates(hostRightCutX, vw, vh)
    : [];

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
    const candidate = attachQuestionIdentity({
      id: `auto-direct-${Date.now()}-${directIndex}-${Math.random().toString(36).slice(2, 8)}`,
      bbox: candidateBbox,
      previewText: previewText.slice(0, 420),
      displaySegments: structuredHost ? extractStructuredQuestionDisplaySegments(structuredHost) : undefined,
      hasImage: hasMeaningfulVisualContent(rectSource),
      questionImageUrl: pickQuestionImageFromElement(rectSource) ?? undefined,
      questionTypeGuess: guessed,
      confidence: 0.9,
      source: "auto_dom",
    }, rectSource);

    const gid = `direct-card-${directIndex}`;
    const rank = completenessScore(candidate.previewText, candidate.questionTypeGuess, candidate.confidence) + 20;
    const prev = groupRank.get(gid) ?? -Infinity;
    if (rank > prev) {
      groupRank.set(gid, rank);
      grouped.set(gid, candidate);
    }
  }

  if (!preferDirectCardMode) {
    if (pintiaQuestionListBlocks.length > 0) {
      return filterFragmentBlocks(deduplicateBlocks(pintiaQuestionListBlocks).sort((a, b) => a.bbox.y - b.bbox.y));
    }
    const stableContainerBlocks = buildStableStructuredContainerCandidates(stableQuestionCards, hostRightCutX, vw, vh);
    if (stableContainerBlocks.length > 0) {
      return filterFragmentBlocks(deduplicateBlocks(stableContainerBlocks).sort((a, b) => a.bbox.y - b.bbox.y));
    }
    if (pintiaCodeProblemBlocks.length > 0 && !hasStructuredContainers) {
      return filterFragmentBlocks(deduplicateBlocks(pintiaCodeProblemBlocks).sort((a, b) => a.bbox.y - b.bbox.y));
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

    const candidate = attachQuestionIdentity({
      id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bbox: candidateBbox,
      previewText: previewText.slice(0, 420),
      hasImage: score.hasImage,
      questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
      questionTypeGuess: candidateType,
      confidence: score.confidence,
      source: "auto_dom",
    }, el);

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

    out.push(attachQuestionIdentity({
      id: `auto-structured-${Date.now()}-${index++}`,
      bbox: clampRectToBbox(rect, vw, vh),
      previewText: previewText.slice(0, 420),
      displaySegments,
      hasImage: hasMeaningfulVisualContent(hostContainer) || !!hostContainer.querySelector("table"),
      questionImageUrl: pickQuestionImageFromElement(hostContainer) ?? undefined,
      questionTypeGuess: candidateType,
      confidence: 0.94,
      source: "auto_dom",
    }, hostContainer));
  }

  return out;
}

function buildPintiaCodeProblemCandidates(
  hostRightCutX: number | null,
  vw: number,
  vh: number,
): QuestionBlock[] {
  const selectors = ["main", "article", "section", "div"];
  const candidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      if (!(node instanceof HTMLElement)) continue;
      if (seen.has(node) || isExtensionUiElement(node)) continue;
      if (!isLikelyPintiaCodeProblemContainer(node, vw)) continue;
      seen.add(node);
      candidates.push(node);
    }
  }

  const rankedCandidates = candidates
    .map((candidate) => ({ candidate, score: scorePintiaCodeProblemContainer(candidate, vw) }))
    .sort((a, b) => b.score - a.score);
  const picked: HTMLElement[] = [];
  for (const entry of rankedCandidates) {
    if (picked.some((existing) => existing.contains(entry.candidate) || entry.candidate.contains(existing))) continue;
    picked.push(entry.candidate);
  }
  const out: QuestionBlock[] = [];

  for (const [index, el] of picked.entries()) {
    const rawRect = el.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 360 || rect.height < 220) continue;
    if (getVisibleVerticalRatio(rawRect, vh) < 0.22) continue;

    const displaySegments = buildPintiaCodeProblemDisplaySegments(el);
    const text = buildPintiaPreviewText(displaySegments);
    if (!text || text.length < 120) continue;
    if (isLikelyControlPanelText(text) || !isLikelyCompleteQuestionText(text, "short_answer")) continue;

    out.push(attachQuestionIdentity({
      id: `auto-pintia-code-${Date.now()}-${index}`,
      bbox: clampRectToBbox(rect, vw, vh),
      previewText: sanitizePreviewTextByType(text, "short_answer").slice(0, 900),
      displaySegments,
      hasImage: hasMeaningfulVisualContent(el),
      questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
      questionTypeGuess: "short_answer",
      confidence: 0.91,
      source: "auto_dom",
    }, el));
  }

  return out;
}

function buildPintiaQuestionListCandidates(
  hostRightCutX: number | null,
  vw: number,
  vh: number,
): QuestionBlock[] {
  const roots = Array.from(document.querySelectorAll("div[id]"))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((el) => isLikelyPintiaQuestionListItem(el));
  const out: QuestionBlock[] = [];

  for (const [index, el] of roots.entries()) {
    const rawRect = el.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 480 || rect.height < 96) continue;
    if (getVisibleVerticalRatio(rawRect, vh) < 0.18) continue;

    const text = normalizeText(extractReadableNodeText(el));
    if (!text || text.length < 24) continue;

    let candidateType = inferQuestionType(text);
    if (candidateType === "unknown" && /\bT\b[\s\n]*\bF\b/i.test(text)) {
      candidateType = "judge";
    }
    const previewText = sanitizePreviewTextByType(text, candidateType);
    if (!isLikelyCompleteQuestionText(previewText, candidateType)) continue;

    out.push(attachQuestionIdentity({
      id: `auto-pintia-list-${Date.now()}-${index}`,
      bbox: clampRectToBbox(rect, vw, vh),
      previewText: previewText.slice(0, 420),
      hasImage: hasMeaningfulVisualContent(el),
      questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
      questionTypeGuess: candidateType,
      confidence: 0.93,
      source: "auto_dom",
    }, el));
  }

  return out;
}

function scorePintiaCodeProblemContainer(el: HTMLElement, vw: number): number {
  const rect = el.getBoundingClientRect();
  const text = normalizeText(extractReadableNodeText(el));
  const cls = (el.className || "").toString().toLowerCase();
  const markerCount = [
    "题目描述",
    "函数接口定义",
    "裁判测试程序样例",
    "输入格式",
    "输出格式",
    "输入样例",
    "输出样例",
    "代码长度限制",
    "时间限制",
    "内存限制",
    "栈限制",
  ].filter((marker) => text.includes(marker)).length;

  let score = markerCount * 10;
  if (el.querySelector("[class*='title'], [id*='title'], h1, h2, h3")) score += 40;
  if (text.includes("作者") && text.includes("单位")) score += 20;
  if (/left_|splitarea|problem-panel|problem-body/.test(cls)) score += 18;
  if (/rendered-markdown|bg-bg-base space-y-4|hyphens-auto/.test(cls)) score -= 10;
  if (rect.width > vw * 0.58) score -= 8;
  if (rect.width < 380) score -= 6;
  return score;
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
        blocks.push(attachQuestionIdentity({
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
        }, el));
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

function isLikelyPintiaCodeProblemContainer(el: HTMLElement, vw: number): boolean {
  if (!isElementVisible(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 360 || rect.height < 220) return false;
  if (rect.left > vw * 0.6) return false;

  const text = normalizeText(extractReadableNodeText(el));
  if (text.length < 120) return false;
  if (isLikelyControlPanelText(text)) return false;
  if (text.includes("考试公告")) return false;
  if (text.includes("题目总览") && text.includes("作答 / 题数")) return false;
  if (text.includes("提交代码")) return false;
  if ((text.match(/第\s*\d+\s*页/g) || []).length >= 3) return false;
  if ((text.match(/\b(?:1|2|3|4|5|6|7|8|9|10)\b/g) || []).length >= 8 && text.includes("图例")) return false;

  const normalizedClass = `${el.tagName.toLowerCase()} ${(el.className || "").toString().toLowerCase()}`;
  if (/(?:^|\\s)(?:cm-editor|cm-scroller|cm-content)(?:\\s|$)|codeeditor_|readonly_|right_/i.test(normalizedClass)) {
    return false;
  }
  const looksProblemPane = /(problem|description|content|statement|markdown|space-y-4|left_|splitarea)/.test(normalizedClass);
  const markerCount = [
    "题目描述",
    "函数接口定义",
    "裁判测试程序样例",
    "输入格式",
    "输出格式",
    "输入样例",
    "输出样例",
    "输入说明",
    "输出说明",
    "样例输入",
    "样例输出",
    "作者",
    "单位",
    "时间限制",
    "内存限制",
    "代码长度限制",
    "栈限制",
  ].filter((marker) => text.includes(marker)).length;
  const hasNarrative = /[A-Za-z]{4,}/.test(text) || /[。；：]/.test(text);
  const hasProblemTab = Array.from(el.querySelectorAll("button,span,div,h1,h2,h3")).some((node) => {
    const label = normalizeText(node.textContent || "");
    return label === "题目描述" || label === "输入格式" || label === "样例输入" || label === "函数接口定义";
  });
  const hasTitleLikeRow = !!el.querySelector("[class*='title'], [id*='title'], h1, h2, h3");
  const hasConstraintMeta = ["时间限制", "内存限制", "代码长度限制", "栈限制"].some((marker) => text.includes(marker));
  const hasCodeProblemMarker = ["函数接口定义", "裁判测试程序样例", "输入样例", "输出样例"].some((marker) => text.includes(marker));
  const hasMetaRow = text.includes("作者") && text.includes("单位");
  const isProblemShell = /left_|splitarea|problem|description/.test(normalizedClass);

  return hasNarrative && (
    (hasProblemTab && markerCount >= 2) ||
    (looksProblemPane && hasTitleLikeRow && markerCount >= 2) ||
    (hasConstraintMeta && hasTitleLikeRow) ||
    (isProblemShell && hasCodeProblemMarker && (hasTitleLikeRow || hasMetaRow)) ||
    (isProblemShell && markerCount >= 3 && (hasTitleLikeRow || hasMetaRow))
  );
}

function buildPintiaCodeProblemDisplaySegments(container: HTMLElement) {
  const segments: QuestionDisplaySegment[] = [];
  const pushSegment = (segment: QuestionDisplaySegment | null) => {
    if (!segment) return;
    if (segment.type === "image") {
      segments.push(segment);
      return;
    }
    const normalized = normalizePintiaDisplayText(segment.text);
    if (!normalized) return;
    const dedupeKey = `${segment.role || "text"}|${segment.label || ""}|${normalized}`;
    if (segments.some((existing) => existing.type === "text" && `${existing.role || "text"}|${existing.label || ""}|${existing.text}` === dedupeKey)) {
      return;
    }
    segments.push({ ...segment, text: normalized });
  };

  const titleNode = pickBestPintiaTitleNode(container);
  if (titleNode instanceof HTMLElement) {
    pushSegment({ type: "text", text: titleNode.innerText || titleNode.textContent || "", role: "title" });
  }

  const metaNode = pickBestPintiaMetaNode(container);
  if (metaNode instanceof HTMLElement) {
    pushSegment({ type: "text", text: metaNode.innerText || metaNode.textContent || "", role: "meta" });
  }

  const markdownRoot = getPintiaRenderedMarkdownRoot(container);
  if (markdownRoot) {
    let currentLabel = "题目描述";
    const sectionMap = new Map<string, string[]>();
    const appendToSection = (label: string, text: string) => {
      const normalized = normalizePintiaDisplayText(text);
      if (!normalized) return;
      const list = sectionMap.get(label) || [];
      if (!list.includes(normalized)) list.push(normalized);
      sectionMap.set(label, list);
    };

    for (const node of Array.from(markdownRoot.children)) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches("h1,h2,h3,h4,h5,h6")) {
        currentLabel = normalizePintiaSectionLabel(node.innerText || node.textContent || "") || currentLabel;
        continue;
      }
      if (node.matches("table") || node.querySelector("table")) {
        appendToSection(currentLabel, formatPintiaTableText(node.matches("table") ? node : node.querySelector("table")));
        continue;
      }
      if (node.matches("[data-code]") || node.querySelector("[data-code], .cm-content, pre, code")) {
        appendToSection(currentLabel, extractPintiaCodeBlockText(node, { preserveNumericOnlyLines: /样例输入|输入样例|样例输出|输出样例/.test(currentLabel) }));
        continue;
      }
      appendToSection(currentLabel, extractReadableNodeText(node));
    }

    for (const [label, parts] of sectionMap.entries()) {
      const text = normalizePintiaDisplayText(parts.join("\n\n"));
      if (!text) continue;
      pushSegment({ type: "text", text, role: "section", label });
    }
  } else {
    const fallbackText = extractReadableNodeText(container);
    pushSegment({ type: "text", text: fallbackText, role: "section", label: "题目描述" });
  }

  if (segments.length === 0) {
    pushSegment({ type: "text", text: extractReadableNodeText(container), role: "section", label: "题目描述" });
  }

  return segments.length ? segments : undefined;
}

function buildPintiaPreviewText(segments?: QuestionDisplaySegment[]): string {
  if (!segments?.length) return "";
  const parts = segments.flatMap((segment) => {
    if (segment.type !== "text") return [];
    if (segment.role === "section") {
      const label = normalizePintiaDisplayText(segment.label || "");
      return label ? [`${label}\n${segment.text}`] : [segment.text];
    }
    return [segment.text];
  });
  return normalizeText(parts.join("\n\n"));
}

function normalizePintiaDisplayText(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function formatPintiaTableText(tableLike: Element | null): string {
  if (!(tableLike instanceof HTMLElement)) return "";
  const table = tableLike.matches("table") ? tableLike : tableLike.querySelector("table");
  if (!(table instanceof HTMLTableElement)) return normalizeText(extractReadableNodeText(tableLike));

  const rows = Array.from(table.querySelectorAll("tr"))
    .map((tr) =>
      Array.from(tr.querySelectorAll("th,td"))
        .map((cell) => normalizeText(cell.textContent || ""))
        .filter(Boolean),
    )
    .filter((cells) => cells.length > 0);

  if (rows.length === 0) return "";

  const lines = rows.map((cells) => cells.join(" | "));
  return lines.join("\n");
}

function getPintiaRenderedMarkdownRoot(container: HTMLElement): HTMLElement | null {
  const direct = container.querySelector(".rendered-markdown");
  return direct instanceof HTMLElement ? direct : null;
}

function normalizePintiaSectionLabel(text: string): string {
  const normalized = normalizePintiaDisplayText(text).replace(/[：:]\s*$/, "");
  if (!normalized) return "";
  if (normalized.startsWith("函数接口定义")) return "函数接口";
  if (normalized.startsWith("裁判测试程序样例")) return "裁判样例";
  if (normalized.startsWith("输入格式")) return "输入格式";
  if (normalized.startsWith("输出格式")) return "输出格式";
  if (normalized.startsWith("输入样例")) return normalized.replace(/[：:]\s*$/, "");
  if (normalized.startsWith("输出样例")) return normalized.replace(/[：:]\s*$/, "");
  if (normalized.startsWith("样例输入")) return normalized;
  if (normalized.startsWith("样例输出")) return normalized;
  return normalized;
}

function extractPintiaCodeBlockText(node: Element, options?: { preserveNumericOnlyLines?: boolean }): string {
  const editorLines = Array.from(node.querySelectorAll(".cm-content .cm-line"))
    .map((line) => normalizePintiaCodeLine((line.textContent || "").replace(/\u00a0/g, " "), options))
    .filter((line) => line !== null);
  if (editorLines.length > 0) {
    return editorLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const pre = node.querySelector("pre");
  if (pre instanceof HTMLElement) {
    return String(pre.textContent || "")
      .replace(/\r\n?/g, "\n")
      .trim();
  }

  const text = normalizePintiaDisplayText(extractReadableNodeText(node))
    .replace(/^\[\s*(?:in|out|c\+\+)\s*\]\s*/gi, "")
    .replace(/^(?:复制内容|格式|全屏|收起)\s*/g, "")
    .replace(/\b(?:复制内容|格式|全屏|收起)\b/g, "")
    .replace(/(?:^|\n)\s*\d+(?=\s*$)/gm, "")
    .trim();
  return text;
}

function normalizePintiaCodeLine(text: string, options?: { preserveNumericOnlyLines?: boolean }): string | null {
  const normalized = String(text || "").replace(/\r\n?/g, "").trimEnd();
  if (!normalized) return "";
  if (/^(?:复制内容|格式|全屏|收起|\[\s*(?:in|out|c\+\+)\s*\])$/i.test(normalized)) return null;
  if (/^\d+$/.test(normalized) && !options?.preserveNumericOnlyLines) return null;
  if (/^[▸▾]+$/.test(normalized)) return null;
  return normalized;
}

function pickBestPintiaTitleNode(container: HTMLElement): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll(
    ".text-darkest.font-bold.text-lg,h1,h2,h3,[id='title'],[id$='-title'],[id*='question-title']",
  )).filter((node): node is HTMLElement => node instanceof HTMLElement);
  if (candidates.length === 0) return null;
  const scored = candidates
    .map((node) => {
      const text = normalizeText(node.innerText || node.textContent || "");
      const cls = String(node.className || "");
      let score = 0;
      if (/^\d+-\d+\s+\S+/.test(text)) score += 100;
      if (/text-darkest font-bold text-lg/.test(cls)) score += 40;
      if (/title/i.test(node.id || "")) score += 10;
      score -= text.length / 200;
      return { node, text, score };
    })
    .filter((entry) => entry.text.length >= 4)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.node ?? null;
}

function pickBestPintiaMetaNode(container: HTMLElement): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll("div,span"))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map((node) => ({ node, text: normalizeText(node.innerText || node.textContent || "") }))
    .filter((entry) => entry.text.includes("作者") && entry.text.includes("单位"))
    .filter((entry) => entry.text.length <= 80);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.text.length - b.text.length)[0]?.node ?? null;
}

function isLikelyPintiaQuestionListItem(el: HTMLElement): boolean {
  if (!isElementVisible(el) || isExtensionUiElement(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 480 || rect.height < 96) return false;

  const id = (el.id || "").trim();
  const cls = (el.className || "").toString().toLowerCase();
  if (!/^\d{8,}$/.test(id)) return false;
  if (!/(?:^|\s)pc-x(?:\s|$)/.test(cls) || !cls.includes("scroll-mt-0")) return false;

  const text = normalizeText(extractReadableNodeText(el));
  if (text.length < 24 || text.length > 900) return false;
  if (text.includes("考试公告")) return false;

  const hasHeader = /^\d+-\d+\s+分数\s*\d+/i.test(text);
  const hasJudgeChoices = /\bT\b[\s\n]*\bF\b/i.test(text);
  const hasChoiceSignals = countOptionMarkersInText(text) >= 2;

  return hasHeader && (hasJudgeChoices || hasChoiceSignals || hasStrongQuestionSignal(text));
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
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (style.opacity === "0") return false;
  if (el.offsetParent !== null) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
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

function isPintiaHost(): boolean {
  return (window.location.hostname || "").toLowerCase().includes("pintia.cn");
}

function _isPintiaProgrammingProblemPage(): boolean {
  if (!isPintiaHost()) return false;
  return /\/exam\/problems\/type\/7(?:\/|$|\?)/.test(window.location.pathname);
}

function isPintiaCodeProblemStatementPage(): boolean {
  if (!isPintiaHost()) return false;
  if (!/\/exam\/problems\/type\/[67](?:\/|$|\?)/.test(window.location.pathname)) return false;
  return new URLSearchParams(window.location.search).has("problemSetProblemId");
}

function isPintiaQuestionListPage(): boolean {
  if (!isPintiaHost()) return false;
  return /\/exam\/problems\/type\/[1-6](?:\/|$|\?)/.test(window.location.pathname);
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
