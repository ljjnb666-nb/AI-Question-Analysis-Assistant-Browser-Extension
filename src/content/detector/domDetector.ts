/**
 * DOM Detector (rebuilt)
 * - Detects question candidates in viewport
 * - Watches SPA mutations
 * - Filters control-panel/navigation blocks
 */

import type { QuestionBlock, QuestionType, BoundingBox, QuestionDisplaySegment } from "@/shared/types";
import { logWarn } from "@/shared/utils/errorLogger";
import {
  extractSemanticSvgLikeText,
  findNearbySemanticFormulaTextForImage,
  hasNearbyLargeVisualImageForSemanticNode,
} from "../formulaEmbedFallback";

const OPTION_RE = /[A-D][\.\):\uFF1A\u3001]/g;
const CIRCLED_RE = /[\u2460\u2461\u2462\u2463]/g;
const QUESTION_RE = /[?\uFF1F]|下列|哪项|正确的是|错误的是|属于|不属于/;
const JUDGE_HEADER_RE = /\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)/g;
const JUDGE_HEADER_START_RE = /\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?/;

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
    const rawRect = (el as HTMLElement).getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 80 || rect.height < 16) continue;

    const text = getElementReadableText(el);
    if (!text || text.length < 10) continue;
    if (isLikelyControlPanelText(text)) continue;

    let candidateBbox = applyRightCutToBbox(refineCandidateRect(el, rect, vw, vh), hostRightCutX);
    let previewText = buildPreviewTextForBbox(el, candidateBbox, text);
    const guessed = inferQuestionType(previewText || text);
    candidateBbox = refineBboxForDetectedType(el, candidateBbox, guessed, vw, vh);
    previewText = sanitizePreviewTextByType(buildPreviewTextForBbox(el, candidateBbox, text), guessed);
    if (!isLikelyCompleteQuestionText(previewText, guessed)) continue;
    const candidate: QuestionBlock = {
      id: `auto-direct-${Date.now()}-${directIndex}-${Math.random().toString(36).slice(2, 8)}`,
      bbox: candidateBbox,
      previewText: previewText.slice(0, 420),
      hasImage: !!el.querySelector("img, canvas, svg, math, figure, mjx-container, .MathJax, .katex, embed"),
      questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
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
      hasImage: !!hostContainer.querySelector("img, canvas, svg, math, figure, mjx-container, .MathJax, .katex, embed, table"),
      questionImageUrl: pickQuestionImageFromElement(hostContainer) ?? undefined,
      questionTypeGuess: candidateType,
      confidence: 0.94,
      source: "auto_dom",
    });
  }

  return out;
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

  if (el.querySelector("img, canvas, svg, math, figure, mjx-container, .MathJax, .katex, embed")) {
    hasImage = true;
    confidence += 0.1;
  }
  if (containsMathLikeContent(el, text)) {
    hasImage = true;
    confidence += 0.08;
  }

  if (text.includes("?") || text.includes("？")) confidence += 0.05;
  if (text.length < 20) confidence *= 0.5;

  const tag = el.tagName.toLowerCase();
  if (["nav", "header", "footer", "aside", "script", "style"].includes(tag)) confidence *= 0.1;

  return { confidence: Math.min(confidence, 1), type, hasImage };
}

function pickQuestionImageFromElement(el: Element): string | null {
  const imgs = Array.from(el.querySelectorAll("img")) as HTMLImageElement[];
  let best: { score: number; url: string } | null = null;
  for (const img of imgs) {
    const src = String(img.currentSrc || img.src || "").trim();
    if (!src || /^data:/i.test(src)) continue;
    if (findNearbySemanticFormulaTextForImage(img)) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) continue;
    const area = rect.width * rect.height;
    const score = area;
    if (!best || score > best.score) best = { score, url: src };
  }
  return best?.url ?? null;
}

function inferQuestionType(text: string): QuestionType {
  const t = text.toLowerCase();
  if (["不定项", "多选", "multiple choice", "select all", "all that apply"].some(k => t.includes(k))) return "multi_choice";
  if (["单选", "single choice", "single-select"].some(k => t.includes(k))) return "single_choice";
  if (/(填空|blank|请输入答案|_{3,}|[（(]\s*\d+\s*[)）])/.test(text)) return "fill_blank";
  const optCount = countOptionMarkersInText(text);
  if (optCount >= 2) {
    // Option markers are a stronger signal than judge-like wording.
    return optCount >= 4 ? "single_choice" : "multi_choice";
  }
  if (isJudgeLikeText(text)) return "judge";
  if (optCount >= 4) return "single_choice";
  if (optCount >= 2) return "multi_choice";
  return "unknown";
}

function isJudgeLikeText(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  if (/[（(]\s*[√×TF对错]\s*[)）]/i.test(t)) return true;
  if (/(判断题|是非题|判断下列|判断正误|判断对错)/i.test(t)) return true;
  if (/\b(true|false|t\/f)\b/i.test(t)) return true;
  // Do not treat generic words like "正确/错误" as judge by themselves;
  // they commonly appear in single/multi-choice stems such as "下列错误的是".
  return false;
}

function countOptionMarkersInText(text: string): number {
  const normalized = normalizeText(text);
  const letterOptions = normalized.match(OPTION_RE) || [];
  const circled = normalized.match(CIRCLED_RE) || [];
  return letterOptions.length + circled.length;
}

function countBlankMarkersInText(text: string): number {
  const normalized = normalizeText(text);
  const underscore = normalized.match(/_{3,}|—{2,}|﹍{2,}/g) || [];
  const numbered = normalized.match(/(?:\d+\.\d+|[（(]\d+[)）])/g) || [];
  return underscore.length + numbered.length;
}

function countBlankControls(el: Element): number {
  return el.querySelectorAll("input:not([type='radio']):not([type='checkbox']):not([type='hidden']):not([type='button']):not([type='submit']),textarea,[contenteditable='true']").length;
}

function countJudgeControls(el: Element): number {
  const controlCount = el.querySelectorAll("input[type='radio'],input[type='checkbox']").length;
  const judgeWordCount = (normalizeText(el.textContent || "").match(/(?:对|错|正确|错误|true|false|t\/f)/gi) || []).length;
  return controlCount + Math.min(judgeWordCount, 2);
}

function hasStrongQuestionSignal(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  const optionCount = (t.match(OPTION_RE) || []).length + (t.match(CIRCLED_RE) || []).length;
  if (optionCount >= 3) return true;
  if (QUESTION_RE.test(t)) return true;
  if (isJudgeLikeText(t)) return true;
  if (/(?:_{2,}|填写|blank|简答|材料题|请输入答案)/i.test(t)) return true;
  return false;
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

function normalizeText(raw: string): string {
  return normalizeMathDisplayText(stripSvgCssNoise(String(raw || "")).replace(/\s+/g, " ").trim());
}

function getElementReadableText(el: Element): string {
  if (
    el instanceof HTMLElement &&
    (
      el.matches(".question-item,.questionBox,.base-question-component,.questionContent,.qeustion-content,.markdown-latex-container,.ml-p,.option-item,.option-content") ||
      !!el.querySelector("math,svg,mjx-container,.MathJax,.katex,embed,img")
    )
  ) {
    return extractReadableNodeText(el);
  }

  const raw = el instanceof HTMLElement
    ? (el.innerText || el.textContent || "")
    : (el.textContent || "");
  return normalizeText(raw);
}

function buildPreviewText(el: Element, fallbackText: string): string {
  const bodyLike = el.querySelector(".card-body,.q-body,.question-body,.stem,article,section");
  const sourceNode = bodyLike ?? el;
  const normalized = extractReadableNodeText(sourceNode);
  if (!normalized) return "";

  const pieces = normalized
    .split(/(?=[A-D][\.\):\uFF1A\u3001])|(?=[\u2460\u2461\u2462\u2463])|(?=\d+[\.、\)）])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^(答案\s*[:：]|查看解析|收藏|试题篮|难度\s*[:：])/.test(s));

  const compact = normalizeText(pieces.join(" "));
  return compact.length >= 20 ? compact : fallbackText.slice(0, 420);
}

function buildPreviewTextForBbox(el: Element, bbox: BoundingBox, fallbackText: string): string {
  const bodyLike = el.querySelector(".card-body,.q-body,.question-body,.stem,article,section");
  const sourceNode = bodyLike ?? el;
  const selector = "h1,h2,h3,h4,p,li,td,th,tr,table,label,span,div,img,svg,math,figure,mjx-container,.MathJax,.katex,embed";
  const nodes = Array.from(sourceNode.querySelectorAll(selector));
  const entries: Array<{ top: number; left: number; text: string }> = [];

  for (const node of nodes) {
    if (isExtensionUiElement(node)) continue;

    const rect = (node as Element).getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (!bboxIntersectsRect(bbox, rect)) continue;

    const tag = node.tagName.toLowerCase();
    if (
      ["div", "span", "p", "li", "label"].includes(tag) &&
      node.childElementCount > 0 &&
      !node.matches(".questionContent,.qeustion-content,.markdown-latex-container,.ml-p")
    ) {
      continue;
    }

    const text = extractReadableNodeText(node);
    if (!text) continue;
    if (text.length > 320) continue;
    if (isLikelyActionText(text) || isLikelyControlPanelText(text)) continue;
    if (node instanceof HTMLElement && node.children.length > 10 && text.length > 180) continue;

    entries.push({ top: rect.top, left: rect.left, text });
  }

  const merged = mergePreviewEntries(entries);
  const compact = sanitizePreviewText(merged);
  if (compact.length >= 20) return compact.slice(0, 420);
  if (sourceNode instanceof HTMLElement) {
    const sourceRect = sourceNode.getBoundingClientRect();
    if (sourceRect.width >= 2 && sourceRect.height >= 2 && bboxIntersectsRect(bbox, sourceRect)) {
      const sourceText = sanitizePreviewText(extractReadableNodeText(sourceNode));
      if (sourceText.length >= 20 && !isLikelyControlPanelText(sourceText) && !isLikelyActionText(sourceText)) {
        return sourceText.slice(0, 420);
      }
    }
  }
  return sanitizePreviewText(buildPreviewText(el, fallbackText)).slice(0, 420);
}

function bboxIntersectsRect(bbox: BoundingBox, rect: DOMRect): boolean {
  return !(
    rect.right <= bbox.x ||
    rect.left >= bbox.x + bbox.width ||
    rect.bottom <= bbox.y ||
    rect.top >= bbox.y + bbox.height
  );
}

function mergePreviewEntries(entries: Array<{ top: number; left: number; text: string }>): string {
  if (!entries.length) return "";
  entries.sort((a, b) => (a.top - b.top) || (a.left - b.left));

  const deduped: Array<{ top: number; left: number; text: string }> = [];
  for (const entry of entries) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text === entry.text && Math.abs(prev.top - entry.top) < 6 && Math.abs(prev.left - entry.left) < 6) continue;
    deduped.push(entry);
  }

  return normalizeText(deduped.map((entry) => entry.text).join(" "));
}

function sanitizePreviewText(text: string): string {
  let out = normalizeText(text);
  if (!out) return "";

  const headNoise = /^(?:返回|作业详情|提交作业|上一题|下一题|标记此题|课堂练习|总分|题目数|答题卡|截止时间)\s*/;
  while (headNoise.test(out)) {
    out = out.replace(headNoise, "").trim();
  }

  const questionStart = out.search(/(?:\d{1,3}\s*[\.、\)）]|第\s*\d{1,3}\s*题|[A-D][\.\):\uFF1A\u3001])/);
  if (questionStart > 0) {
    const prefix = out.slice(0, questionStart);
    if (/返回|作业详情|提交作业|课堂练习|总分|题目数|答题卡|截止时间|单选题|多选题|判断题|填空题/.test(prefix)) {
      out = out.slice(questionStart).trim();
    }
  }

  out = sanitizeJudgePreviewText(out);

  return out;
}

function sanitizePreviewTextByType(text: string, type: QuestionType): string {
  const normalized = sanitizePreviewText(text);
  if (!normalized) return "";
  if (type === "single_choice" || type === "multi_choice") {
    return sanitizeChoicePreviewText(normalized);
  }
  if (type === "judge") {
    return sanitizeJudgePreviewText(normalized);
  }
  return normalized;
}

function sanitizeChoicePreviewText(text: string): string {
  const normalized = sanitizePreviewText(text);
  if (!normalized) return "";

  const firstOptionIdx = normalized.search(/[A-D][\.\):\uFF1A\u3001]/);
  if (firstOptionIdx < 0) return trimTrailingQuestionMarker(normalized);

  const stem = trimTrailingQuestionMarker(normalizeText(normalized.slice(0, firstOptionIdx)));
  const optionSegment = normalized.slice(firstOptionIdx);
  const rawMatches = Array.from(optionSegment.matchAll(/([A-D])[\.\):\uFF1A\u3001]\s*([\s\S]*?)(?=(?:\s+[A-D][\.\):\uFF1A\u3001])|$)/g));
  const dedup = new Map<string, string>();
  for (const match of rawMatches) {
    const key = match[1];
    const value = sanitizeChoiceOptionValue(match[2] || "");
    if (!value) continue;
    if (!dedup.has(key)) dedup.set(key, value);
  }

  if (dedup.size < 2) return trimTrailingQuestionMarker(normalized);
  const rebuiltOptions = [...dedup.entries()].map(([key, value]) => `${key}. ${value}`).join(" ");
  return normalizeText(`${stem} ${rebuiltOptions}`);
}

function sanitizeChoiceOptionValue(raw: string): string {
  let out = normalizeText(raw);
  if (!out) return "";

  const noisePattern = /(?:返回|作业详情|提交作业|上一题|下一题|标记此题|课堂练习|总分|题目数|答题卡|截止时间|在线客服|文件预览|submit|previous|next)/i;
  const noiseMatch = noisePattern.exec(out);
  if (noiseMatch && noiseMatch.index > 0) {
    out = normalizeText(out.slice(0, noiseMatch.index));
  }

  return trimTrailingQuestionMarker(out);
}

function containsMathLikeContent(el: Element, text: string): boolean {
  if (el.querySelector("math, mjx-container, .MathJax, .katex, embed")) return true;
  const t = normalizeText(text).toLowerCase();
  if (!t) return false;
  return /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|lim|sin|cos|tan|e\^|s\^|jω|jw|σ|ω|∫|Σ|√|≤|≥|≠|传递函数|奈奎斯特|伯德图)/i.test(t);
}

function extractReadableNodeText(node: Element): string {
  const tag = node.tagName.toLowerCase();
  const attrText = [
    node.getAttribute("aria-label"),
    node.getAttribute("alt"),
    node.getAttribute("title"),
    node.getAttribute("data-alt"),
  ].find((v) => normalizeText(v || ""));

  if (tag === "img") {
    if (node.closest(".option-item") && /icon-lou|aloha-icon|iconfont/i.test(node.getAttribute("class") || "")) {
      return "";
    }
    if (findNearbySemanticFormulaTextForImage(node)) {
      return "";
    }
    return normalizeText(attrText || "[图片]");
  }

  if (tag === "embed") {
    const latex = decodeFormulaLikeText(
      node.getAttribute("data-svg-latex")
      || node.getAttribute("data-latex")
      || node.getAttribute("alt")
      || node.getAttribute("title")
      || "",
    );
    return normalizeText(latex || attrText || "[公式]");
  }

  if (tag === "canvas") {
    return normalizeText(attrText || "[图形]");
  }

  if (tag === "svg") {
    if (hasNearbyLargeVisualImageForSemanticNode(node)) return "";
    return normalizeText(extractSemanticSvgLikeText(node) || "[公式]");
  }

  if (tag === "math" || tag === "mjx-container") {
    if (hasNearbyLargeVisualImageForSemanticNode(node)) return "";
    return normalizeText(extractSemanticSvgLikeText(node) || "[公式]");
  }

  if (node.matches(".MathJax, .katex")) {
    if (hasNearbyLargeVisualImageForSemanticNode(node)) return "";
    return normalizeText(extractSemanticSvgLikeText(node) || "[公式]");
  }

  if (node instanceof HTMLElement) {
    if (node.matches(".option-item")) {
      const orderText = normalizeText((node.querySelector(".option-order") as HTMLElement | null)?.innerText || "");
      const contentNode = node.querySelector(".option-content,.markdown-latex-container,.ml-p");
      const contentText = normalizeText(
        contentNode ? extractReadableNodeText(contentNode) : (node.innerText || node.textContent || ""),
      );
      return normalizeText(`${orderText} ${contentText}`);
    }

    if (node.matches(".question-item,.questionBox,.base-question-component")) {
      return extractStructuredQuestionText(node);
    }

    if (node.matches(".questionContent,.qeustion-content")) {
      return extractOrderedChildContentText(node, (child) => child.matches(".option-item,.option-content,.optionUl,ul,ol"));
    }

    if (
      node.childElementCount > 0 &&
      node.matches(".markdown-latex-container,.ml-p,.option-content")
    ) {
      return extractOrderedChildContentText(node);
    }

    if (
      node.childElementCount > 0 &&
      node.querySelector("svg,math,mjx-container,.MathJax,.katex,embed,img")
    ) {
      return extractOrderedChildContentText(node);
    }

    return normalizeText(node.innerText || node.textContent || attrText || "");
  }

  return normalizeText(node.textContent || attrText || "");
}

function extractOrderedChildContentText(
  node: HTMLElement,
  shouldSkipChild?: (child: Element) => boolean,
): string {
  const orderedPieces = Array.from(node.childNodes)
    .map((child) => readInlineOrderedChildContent(child, shouldSkipChild))
    .filter(Boolean);

  return normalizeText(dedupeJoinedStructuredText(orderedPieces).join(""));
}

function readInlineOrderedChildContent(
  node: Node,
  shouldSkipChild?: (child: Element) => boolean,
): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (!(node instanceof Element)) return "";
  if (shouldSkipChild?.(node)) return "";

  const tag = node.tagName.toLowerCase();
  if (
    tag === "img" ||
    tag === "svg" ||
    tag === "math" ||
    tag === "mjx-container" ||
    tag === "embed" ||
    node.matches(".MathJax, .katex")
  ) {
    return ` ${extractReadableNodeText(node)} `;
  }
  if (tag === "sub") {
    const text = normalizeText(node.textContent || "");
    return text ? text.replace(/\s+/g, "") : "";
  }
  if (tag === "sup") {
    const text = normalizeText(node.textContent || "");
    return text ? `^${text.replace(/\s+/g, "")}` : "";
  }
  if (tag === "br") return " ";

  const inlineChildren = Array.from(node.childNodes)
    .map((child) => readInlineOrderedChildContent(child, shouldSkipChild))
    .filter(Boolean);

  if (inlineChildren.length > 0) {
    const joined = inlineChildren.join("");
    if (tag === "span" || tag === "strong" || tag === "em" || tag === "b" || tag === "i" || tag === "u") {
      return joined;
    }
    return ` ${joined} `;
  }

  return ` ${extractReadableNodeText(node)} `;
}

function extractStructuredQuestionText(container: Element): string {
  const pieces: string[] = [];
  const push = (value: string) => {
    const normalized = normalizeText(value);
    if (!normalized) return;
    const next = dedupeJoinedStructuredText([...pieces, normalized]);
    pieces.splice(0, pieces.length, ...next);
  };

  const titleBox = container.querySelector(".title-box,.questionTit,.question-title");
  if (titleBox instanceof HTMLElement) {
    push(titleBox.innerText || titleBox.textContent || "");
  }

  const stemNode = container.querySelector(".qeustion-content,.questionContent,.question-content,.stem,.question-body,.content");
  if (stemNode) {
    push(extractReadableNodeText(stemNode));
  }

  const tableNodes = Array.from(container.querySelectorAll("table"));
  for (const tableNode of tableNodes) {
    push(extractReadableNodeText(tableNode));
  }

  const optionNodes = Array.from(container.querySelectorAll(".option-item, li, label"))
    .filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (!isElementVisible(node)) return false;
      const text = normalizeText(node.innerText || node.textContent || "");
      return /^[A-D][\.\):\uFF1A\u3001]/.test(text) || /^[\u2460\u2461\u2462\u2463]/.test(text);
    });
  for (const optionNode of optionNodes) {
    push(extractReadableNodeText(optionNode));
  }

  if (pieces.length === 0) {
    push(container instanceof HTMLElement ? (container.innerText || container.textContent || "") : (container.textContent || ""));
  }

  return normalizeText(dedupeJoinedStructuredText(pieces).join(" "));
}

function extractStructuredQuestionDisplaySegments(container: Element): QuestionDisplaySegment[] | undefined {
  const stemNode = container.querySelector(".qeustion-content,.questionContent,.question-content,.stem,.question-body,.content");
  if (!(stemNode instanceof HTMLElement)) return undefined;

  const segments = buildOrderedDisplaySegments(stemNode, (child) =>
    child.matches(".option-item,.option-content,.optionUl,ul,ol,.sign-box,.flex.items-center.gap-12px"),
  );

  return segments.length ? segments : undefined;
}

function buildOrderedDisplaySegments(
  root: Element,
  shouldSkipChild?: (child: Element) => boolean,
): QuestionDisplaySegment[] {
  const out: QuestionDisplaySegment[] = [];

  const pushText = (text: string) => {
    const normalized = normalizeText(text);
    if (!normalized) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text") {
      prev.text = normalizeText(`${prev.text} ${normalized}`);
      return;
    }
    out.push({ type: "text", text: normalized });
  };

  const pushInlineText = (text: string) => {
    const normalized = normalizeText(text);
    if (!normalized) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text") {
      prev.text = normalizeText(`${prev.text}${normalized}`);
      return;
    }
    out.push({ type: "text", text: normalized });
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent || "");
      return;
    }
    if (!(node instanceof Element)) return;
    if (shouldSkipChild?.(node)) return;
    if (isExtensionUiElement(node)) return;

    const tag = node.tagName.toLowerCase();
    if (tag === "br") return;
    if (tag === "sub" || tag === "sup" || tag === "span" || tag === "strong" || tag === "em" || tag === "b" || tag === "i" || tag === "u") {
      pushInlineText(readInlineOrderedChildContent(node, shouldSkipChild));
      return;
    }
    if (tag === "img") {
      const formulaText = findNearbySemanticFormulaTextForImage(node);
      if (formulaText) return;
      const url = String((node as HTMLImageElement).currentSrc || node.getAttribute("src") || "").trim();
      if (url) out.push({ type: "image", url });
      return;
    }
    if (tag === "svg" || tag === "math" || tag === "mjx-container" || node.matches(".MathJax, .katex")) {
      if (hasNearbyLargeVisualImageForSemanticNode(node)) return;
      pushText(extractSemanticSvgLikeText(node));
      return;
    }
    if (tag === "embed") {
      pushText(extractReadableNodeText(node));
      return;
    }

    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }
  };

  for (const child of Array.from(root.childNodes)) {
    walk(child);
  }

  return out
    .map((segment) => segment.type === "text" ? { ...segment, text: trimTrailingQuestionMarker(segment.text) } : segment)
    .filter((segment) => segment.type === "image" || segment.text);
}

function trimTrailingQuestionMarker(text: string): string {
  let out = normalizeText(text);
  if (!out) return "";

  out = out
    .replace(/\s+[一二三四五六七八九十]+、\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]?(?:单选题|多选题|判断题|填空题)?[\]】]?\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]\s*$/u, "")
    .replace(/\s+第\s*[一二三四五六七八九十\d]+\s*[章节题]\s*$/u, "")
    .trim();

  return out;
}

function normalizeMathDisplayText(text: string): string {
  let out = String(text || "");
  if (!out) return "";

  out = out
    .replace(/&infin;|&#8734;|\\infty/gi, "∞")
    .replace(/负无穷/g, "-∞")
    .replace(/正无穷/g, "+∞")
    .replace(/&omega;|&#969;|\\omega/gi, "ω")
    .replace(/&sigma;|&#963;|\\sigma/gi, "σ")
    .replace(/&minus;|&#8722;/gi, "-")
    .replace(/[−﹣－]/g, "-")
    .replace(/[＋﹢]/g, "+")
    .replace(/\b([+-])\s*infty\b/gi, "$1∞")
    .replace(/\binfty\b/gi, "∞")
    .replace(/由\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/g, "由-∞到+∞")
    .replace(/从\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/g, "从-∞到+∞");

  out = out.replace(
    /((?:ω|w|omega)[^。；;,.，]{0,24}?由)\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/gi,
    (_m, prefix) => `${prefix}-∞到+∞`,
  );

  return out;
}

function stripSvgCssNoise(text: string): string {
  let out = String(text || "");
  if (!out) return "";

  out = out
    .replace(/\.[A-Za-z0-9_-]+\s+\.[A-Za-z0-9_-]+\s*\{[^{}]{0,240}\}/g, " ")
    .replace(/\b(?:fill|stroke|stroke-width|stroke-linejoin|stroke-linecap|font-size|font-family|font-style|font-weight)\s*:\s*[^;}{]{1,120};?/gi, " ")
    .replace(/\s{2,}/g, " ");

  return out.trim();
}

function decodeFormulaLikeText(raw: string): string {
  let out = String(raw || "");
  if (!out) return "";
  try {
    out = decodeURIComponent(out);
  } catch {
    // keep raw text
  }

  out = out
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "$1/$2")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\omega/g, "ω")
    .replace(/\\sigma/g, "σ")
    .replace(/\\infty/g, "∞")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s*([=+\-*/])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeMathDisplayText(out);
}

function sanitizeJudgePreviewText(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (!/\[?判断题\]?|(?:对|错|正确|错误)/.test(normalized)) return normalized;

  let out = normalized;
  const headers = Array.from(out.matchAll(JUDGE_HEADER_RE));
  const start = headers[0]?.index ?? out.search(JUDGE_HEADER_START_RE);
  if (start > 0) out = out.slice(start).trim();
  if (headers.length >= 2 && typeof headers[1].index === "number") {
    const secondIndex = headers[1].index!;
    if (secondIndex > 0) out = out.slice(0, secondIndex).trim();
  }

  const noise = /(?:上一题|下一题|提交作业|标记此题|返回|答题卡|课堂练习)/;
  const noiseMatch = noise.exec(out);
  if (noiseMatch && noiseMatch.index > 0) {
    out = out.slice(0, noiseMatch.index).trim();
  }

  const stem = dedupeRepeatedJudgeStem(extractJudgeStemCore(out));
  const hasDui = /(?:^|\s)对(?:\s|$)|正确|\btrue\b/i.test(out);
  const hasCuo = /(?:^|\s)错(?:\s|$)|错误|\bfalse\b/i.test(out);

  out = stem;
  if (hasDui) out += " 对";
  if (hasCuo) out += " 错";

  return out;
}

function extractJudgeStemCore(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "";

  const explicitSentence = normalized.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*.*?[。！？!?])/);
  if (explicitSentence?.[1]) return normalizeText(explicitSentence[1]);

  const cutAtOption = normalized.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*.*?)(?=\s+(?:对|错|正确|错误|true|false)\b)/i);
  if (cutAtOption?.[1]) return normalizeText(cutAtOption[1]);

  return normalized;
}

function dedupeRepeatedJudgeStem(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "";

  const headerMatch = normalized.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*)(.+)$/);
  if (!headerMatch) return normalized;

  const header = headerMatch[1];
  const body = headerMatch[2].trim();
  if (!body) return normalized;

  const firstOptionAt = body.search(/\b(?:对|错|正确|错误|true|false)\b/i);
  const leadStem = normalizeText((firstOptionAt > 0 ? body.slice(0, firstOptionAt) : body).trim());
  if (leadStem.length >= 8) {
    const repeatedLeadAt = body.indexOf(leadStem, leadStem.length);
    if (repeatedLeadAt > 0) {
      return normalizeText(`${header}${body.slice(0, repeatedLeadAt).trim()}`);
    }
  }

  const firstSentence = body.match(/^(.{6,}?[。！？!?])/);
  if (firstSentence?.[1]) {
    const sentence = normalizeText(firstSentence[1]);
    const secondIndex = body.indexOf(sentence, sentence.length);
    if (secondIndex > 0) {
      return normalizeText(`${header}${body.slice(0, secondIndex).trim()}`);
    }
  }

  const probe = normalizeText(body.slice(0, Math.min(24, Math.max(12, Math.floor(body.length / 2)))));
  if (probe.length >= 12) {
    const repeatedAt = body.indexOf(probe, probe.length);
    if (repeatedAt > 0) {
      return normalizeText(`${header}${body.slice(0, repeatedAt).trim()}`);
    }
  }

  return normalizeText(`${header}${body}`);
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

function isLikelyCompleteQuestionText(text: string, type: QuestionType): boolean {
  if (!text) return false;
  if (isLikelyControlPanelText(text)) return false;

  const pageIsJudge = /typeid=600079/i.test(window.location.search);
  const optionCount = (text.match(OPTION_RE) || []).length;
  const circledCount = (text.match(CIRCLED_RE) || []).length;
  const hasABCD = /A[\.\):\uFF1A\u3001][\s\S]*B[\.\):\uFF1A\u3001][\s\S]*C[\.\):\uFF1A\u3001][\s\S]*D[\.\):\uFF1A\u3001]/.test(text);
  const hasQuestion = QUESTION_RE.test(text);
  const startsWithOption = /^[A-D][\.\):\uFF1A\u3001]/.test(text);
  const startsWithIndex = /^[\u2460\u2461\u2462\u2463]/.test(text);

  const judgeLike = (type === "judge" || (pageIsJudge && type === "unknown"))
    && text.length >= 10
    && text.length <= 260
    && !startsWithOption
    && !startsWithIndex
    && /[。！？.!?)]$/.test(text);
  if (judgeLike) return true;

  if (startsWithOption || startsWithIndex) return false;
  if (type === "single_choice" || type === "multi_choice") {
    if (optionCount + circledCount < 4) return false;
    if (!hasABCD && circledCount < 4) return false;
    const hasMathLikePayload = /θ|μ|σ|λ|∞|∑|∫|π|T\d|x_\d|[A-Za-z]\([A-Za-z0-9,+\-*/=()]+\)|\d+\/\d+/.test(text);
    if (!hasQuestion && !hasMathLikePayload && text.length < 60) return false;
  }
  if (type === "unknown") {
    if (optionCount + circledCount < 2 && !hasQuestion) return false;
  }
  if (text.length < 28) return false;
  return true;
}

function completenessScore(text: string, type: QuestionType, confidence: number): number {
  const optionCount = (text.match(OPTION_RE) || []).length;
  const circledCount = (text.match(CIRCLED_RE) || []).length;
  const hasQuestion = /[?\uFF1F]/.test(text);
  let score = confidence * 100;
  score += (optionCount + circledCount) * 8;
  if (hasQuestion) score += 10;
  if (type === "single_choice" || type === "multi_choice") score += 8;
  if (text.length >= 80 && text.length <= 700) score += 8;
  if (text.length > 900) score -= 20;
  return score;
}

function isExtensionUiElement(el: Element): boolean {
  if ((el as HTMLElement).id?.startsWith("qs-")) return true;
  return !!el.closest?.("[id^='qs-']");
}

function isLikelyControlPanelText(text: string): boolean {
  const t = normalizeText(text).toLowerCase();
  if (!t) return false;
  const keys = [
    "试题检索", "教材版本", "课本", "题型", "难易度", "知识点", "当前",
    "试题篮", "组卷预览", "登录", "注册", "首页", "按章节", "按知识点",
  ];
  const hit = keys.reduce((n, k) => n + (t.includes(k.toLowerCase()) ? 1 : 0), 0);
  if (hit >= 3) return true;
  if (t.includes("试题检索") && t.includes("题型")) return true;
  if (t.includes("教材版本") && t.includes("难易度")) return true;
  if ((t.match(/第\d+章/g) || []).length >= 2) return true;
  if ((t.match(/必修\d/g) || []).length >= 3) return true;
  return false;
}

function filterFragmentBlocks(blocks: QuestionBlock[]): QuestionBlock[] {
  const sorted = [...blocks].sort((a, b) => candidateQualityScore(b) - candidateQualityScore(a));
  const kept: QuestionBlock[] = [];
  for (const block of sorted) {
    const text = normalizeText(block.previewText);
    const contained = kept.some((k) => {
      const yNear = Math.abs(k.bbox.y - block.bbox.y) < 160;
      const sameCol = Math.abs(k.bbox.x - block.bbox.x) < 120;
      return yNear && sameCol && normalizeText(k.previewText).includes(text);
    });
    if (!contained) kept.push(block);
  }
  return kept.sort((a, b) => a.bbox.y - b.bbox.y);
}

function mergeAdjacentQuestionBlocks(blocks: QuestionBlock[]): QuestionBlock[] {
  if (blocks.length <= 1) return blocks;
  const sorted = [...blocks].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const used = new Array(sorted.length).fill(false);
  const out: QuestionBlock[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    let cur = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      if (used[j]) continue;
      const next = sorted[j];
      if (!shouldMergeBlocks(cur, next)) continue;
      cur = mergeTwoBlocks(cur, next);
      used[j] = true;
    }
    out.push(cur);
  }

  return out;
}

function shouldMergeBlocks(a: QuestionBlock, b: QuestionBlock): boolean {
  // In direct-card mode, each card body is already one complete question block.
  // Never merge two direct-card candidates, otherwise adjacent questions may collapse into one.
  if (a.id.startsWith("auto-direct-") && b.id.startsWith("auto-direct-")) return false;

  const orderA = extractLeadingQuestionNumber(a.previewText);
  const orderB = extractLeadingQuestionNumber(b.previewText);
  if (orderA !== null && orderB !== null && orderA !== orderB) return false;

  const aBottom = a.bbox.y + a.bbox.height;
  const bTop = b.bbox.y;
  const verticalGap = Math.max(0, bTop - aBottom);
  if (verticalGap > 140) return false;

  const overlapW = Math.max(0, Math.min(a.bbox.x + a.bbox.width, b.bbox.x + b.bbox.width) - Math.max(a.bbox.x, b.bbox.x));
  const minW = Math.max(1, Math.min(a.bbox.width, b.bbox.width));
  const horizontalOverlapRatio = overlapW / minW;
  if (horizontalOverlapRatio < 0.45) return false;

  const aText = normalizeText(a.previewText);
  const bText = normalizeText(b.previewText);
  const aHasOptions = countOptionMarkersInText(aText) >= 2;
  const bHasOptions = countOptionMarkersInText(bText) >= 2;
  if (aHasOptions && bHasOptions) return false;
  const aLooksStem = QUESTION_RE.test(aText) || /下列|正确的是|错误的是|如图|图示/.test(aText);
  const bLooksStem = QUESTION_RE.test(bText) || /下列|正确的是|错误的是|如图|图示/.test(bText);
  const aLooksComplete = isLikelyCompleteQuestionText(aText, a.questionTypeGuess);
  const bLooksComplete = isLikelyCompleteQuestionText(bText, b.questionTypeGuess);

  const complementary = (aHasOptions && bLooksStem) || (bHasOptions && aLooksStem);
  const sameType = a.questionTypeGuess === b.questionTypeGuess || a.questionTypeGuess === "unknown" || b.questionTypeGuess === "unknown";
  const fragmentJoin =
    sameType &&
    Math.abs(verticalGap) <= 64 &&
    (
      (!aLooksComplete && (bHasOptions || bLooksStem)) ||
      (!bLooksComplete && (aHasOptions || aLooksStem))
    );

  return complementary || fragmentJoin;
}

function extractLeadingQuestionNumber(text: string): number | null {
  const normalized = normalizeText(text);
  const match = normalized.match(/^(\d{1,3})\s*[\.、\)）]/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function mergeTwoBlocks(a: QuestionBlock, b: QuestionBlock): QuestionBlock {
  const left = Math.min(a.bbox.x, b.bbox.x);
  const top = Math.min(a.bbox.y, b.bbox.y);
  const right = Math.max(a.bbox.x + a.bbox.width, b.bbox.x + b.bbox.width);
  const bottom = Math.max(a.bbox.y + a.bbox.height, b.bbox.y + b.bbox.height);

  const combinedText = normalizeText([a.previewText, b.previewText].filter(Boolean).join(" "));
  const typeA = a.questionTypeGuess;
  const typeB = b.questionTypeGuess;
  const mergedType: QuestionType =
    typeA !== "unknown"
      ? typeA
      : typeB !== "unknown"
        ? typeB
        : inferQuestionType(combinedText);

  return {
    ...a,
    id: a.id,
    bbox: { x: left, y: top, width: Math.max(20, right - left), height: Math.max(20, bottom - top) },
    previewText: combinedText.slice(0, 900),
    hasImage: a.hasImage || b.hasImage,
    questionTypeGuess: mergedType,
    confidence: Math.min(1, Math.max(a.confidence, b.confidence) + 0.05),
  };
}

function deduplicateBlocks(blocks: QuestionBlock[]): QuestionBlock[] {
  const out: QuestionBlock[] = [];
  for (const b of blocks) {
    const overlapIndex = out.findIndex((k) => {
      if (overlapRatio(k.bbox, b.bbox) > 0.5) return true;
      const sameColumn = Math.abs(k.bbox.x - b.bbox.x) < 120;
      const closeTop = Math.abs(k.bbox.y - b.bbox.y) < 140;
      const textA = normalizeText(k.previewText);
      const textB = normalizeText(b.previewText);
      return sameColumn && closeTop && !!textA && !!textB && (textA.includes(textB) || textB.includes(textA));
    });
    if (overlapIndex < 0) {
      out.push(b);
      continue;
    }
    if (candidateQualityScore(b) > candidateQualityScore(out[overlapIndex])) {
      out[overlapIndex] = b;
    }
  }
  return out;
}

function candidateQualityScore(block: QuestionBlock): number {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const area = Math.max(1, block.bbox.width * block.bbox.height);
  const areaRatio = area / viewportArea;
  const heightRatio = block.bbox.height / Math.max(1, window.innerHeight);
  let score = completenessScore(block.previewText, block.questionTypeGuess, block.confidence);

  if (areaRatio > 0.42) score -= (areaRatio - 0.42) * 220;
  if (heightRatio > 0.68) score -= (heightRatio - 0.68) * 180;
  if ((block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice") && areaRatio > 0.28) {
    score -= 22;
  }
  if (/\b(?:返回|提交作业|上一题|下一题|答题卡)\b/.test(block.previewText)) {
    score -= 26;
  }
  return score;
}

function overlapRatio(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
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

function dedupeJoinedStructuredText(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const normalized = normalizeText(part);
    if (!normalized) continue;
    for (let i = out.length - 1; i >= 0; i--) {
      const existing = out[i];
      if (existing === normalized) {
        out.splice(i, 1);
        continue;
      }
      if (existing.length >= 8 && normalized.includes(existing)) {
        out.splice(i, 1);
      }
    }
    if (out.some((existing) => normalized.length >= 8 && existing.includes(normalized))) continue;
    out.push(normalized);
  }
  return out;
}

function refineCandidateRect(el: Element, baseRect: DOMRect, vw: number, vh: number): BoundingBox {
  const base = clampRect(baseRect, vw, vh);
  const baseArea = Math.max(1, base.width * base.height);
  if (baseArea < 20_000) return base;

  const textItems = collectTextRectItems(el, baseRect, vw, vh);
  const clustered = pickBestQuestionCluster(textItems);
  if (!clustered) return base;

  const controls = collectChoiceControls(el, baseRect, vw, vh);
  const blankControls = collectBlankControls(el, baseRect, vw, vh);
  const withChoiceControls = attachNearbyControls(clustered, controls);
  const withControls = attachNearbyBlankControls(withChoiceControls, blankControls);
  const mediaRects = collectMediaRects(el, baseRect, vw, vh);
  const withMedia = attachRelevantMedia(withControls, mediaRects, normalizeText(el.textContent ?? ""));
  const refinedRect = inflateRect(withMedia, 10, baseRect);
  const refined: BoundingBox = {
    x: Math.max(0, refinedRect.left),
    y: Math.max(0, refinedRect.top),
    width: Math.max(20, Math.min(vw, refinedRect.right) - Math.max(0, refinedRect.left)),
    height: Math.max(20, Math.min(vh, refinedRect.bottom) - Math.max(0, refinedRect.top)),
  };

  const refinedArea = Math.max(1, refined.width * refined.height);
  // Ignore pathological shrinking; only accept meaningful reductions.
  if (refinedArea < baseArea * 0.08) return base;
  if (refinedArea > baseArea * 0.98) return base;
  return refined;
}

function refineBboxForDetectedType(
  el: Element,
  bbox: BoundingBox,
  type: QuestionType,
  vw: number,
  vh: number,
): BoundingBox {
  if (type === "judge") {
    return refineJudgeCandidateRect(el, bbox, vw, vh);
  }
  return bbox;
}

function refineJudgeCandidateRect(el: Element, bbox: BoundingBox, vw: number, vh: number): BoundingBox {
  const relevantRects: DOMRect[] = [];
  const nodes = el.querySelectorAll("div,p,li,label,span,input");

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (isExtensionUiElement(node)) continue;
    if (node === el) continue;

    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (!bboxIntersectsRect(bbox, rect)) continue;
    if (rect.width >= bbox.width * 0.92 && rect.height >= bbox.height * 0.65) continue;
    if (!node.matches("label") && !node.matches("input") && node.childElementCount > 2) continue;
    if (!node.matches("label") && !node.matches("input") && rect.height > 120) continue;

    if (node.matches("input[type='radio'],input[type='checkbox']")) {
      relevantRects.push(rect);
      continue;
    }

    const text = normalizeText(node.innerText || node.textContent || "");
    if (!text) continue;
    if (isLikelyActionText(text) || isSectionHeadingText(text)) continue;
    if (text.length > 180) continue;
    if (
      /^(?:\d{1,3}[\.、\)）]\s*)?\[?判断题\]?/u.test(text) ||
      /(?:对|错|正确|错误|true|false|t\/f)/i.test(text) ||
      (text.length >= 8 && text.length <= 120 && /[。！？.!?)]$/.test(text))
    ) {
      relevantRects.push(rect);
    }
  }

  if (!relevantRects.length) return bbox;

  const union = unionRects(relevantRects);
  const expanded = {
    x: Math.max(0, union.left - 14),
    y: Math.max(0, union.top - 14),
    width: Math.max(20, Math.min(vw, union.right + 14) - Math.max(0, union.left - 14)),
    height: Math.max(20, Math.min(vh, union.bottom + 14) - Math.max(0, union.top - 14)),
  };

  const oldArea = Math.max(1, bbox.width * bbox.height);
  const newArea = Math.max(1, expanded.width * expanded.height);
  if (newArea >= oldArea * 0.92) return bbox;
  return expanded;
}

type RectItem = { rect: DOMRect; text: string; score: number };

function collectTextRectItems(el: Element, baseRect: DOMRect, vw: number, vh: number): RectItem[] {
  const items: RectItem[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (!parent || isExtensionUiElement(parent)) {
      node = walker.nextNode();
      continue;
    }
    const raw = normalizeText(textNode.textContent ?? "");
    if (!raw || isLikelyActionText(raw)) {
      node = walker.nextNode();
      continue;
    }

    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = Array.from(range.getClientRects());
    range.detach?.();

    for (const r of rects) {
      if (r.width < 4 || r.height < 8) continue;
      if (!inViewport(r, vw, vh)) continue;
      if (!intersectsRect(r, baseRect)) continue;
      const score = scoreTextSnippet(raw);
      if (score <= 0) continue;
      items.push({ rect: r, text: raw, score });
    }

    node = walker.nextNode();
  }
  return items;
}

function scoreTextSnippet(text: string): number {
  const t = normalizeText(text);
  if (!t) return 0;
  if (isSectionHeadingText(t)) return -2;
  let score = 0;
  if (QUESTION_RE.test(t)) score += 3;
  if ((t.match(OPTION_RE) || []).length > 0) score += 4;
  if ((t.match(CIRCLED_RE) || []).length > 0) score += 3;
  if (/^\d{1,3}[\.、\)）]/.test(t)) score += 3;
  if (/^[A-D][\.\):\uFF1A\u3001]/.test(t)) score += 3;
  if (/单选|多选|判断|填空|简答|题目|选项/.test(t)) score += 2;
  if (/请输入答案|_{3,}|—{2,}|﹍{2,}/.test(t)) score += 3;
  if (/[\u4e00-\u9fa5]/.test(t) && t.length >= 6) score += 1;
  if (/^\d+$/.test(t)) score -= 1;
  return score;
}

function isSectionHeadingText(text: string): boolean {
  const t = normalizeText(text);
  return /^(?:[一二三四五六七八九十]+、\s*)?(?:单选题|多选题|填空题|判断题|简答题)(?:\s*[（(]\d+分[)）])?$/u.test(t);
}

function pickBestQuestionCluster(items: RectItem[]): DOMRect | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  const clusters: RectItem[][] = [];

  for (const item of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      if (isCloseToCluster(item.rect, cluster)) {
        cluster.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([item]);
  }

  let bestRect: DOMRect | null = null;
  let bestScore = -Infinity;
  for (const cluster of clusters) {
    const rect = unionRects(cluster.map((i) => i.rect));
    const area = Math.max(1, rect.width * rect.height);
    const signal = cluster.reduce((s, i) => s + i.score, 0);
    const density = signal / Math.max(1, cluster.length);
    const clusterScore = signal * 2 + density * 3 + cluster.length - area / 120000;
    if (clusterScore > bestScore) {
      bestScore = clusterScore;
      bestRect = rect;
    }
  }
  return bestRect;
}

function isCloseToCluster(rect: DOMRect, cluster: RectItem[]): boolean {
  const cRect = unionRects(cluster.map((i) => i.rect));
  const verticalGap = Math.max(0, Math.max(cRect.top - rect.bottom, rect.top - cRect.bottom));
  const horizontalGap = Math.max(0, Math.max(cRect.left - rect.right, rect.left - cRect.right));
  const xOverlap = Math.max(0, Math.min(cRect.right, rect.right) - Math.max(cRect.left, rect.left));
  const minW = Math.max(1, Math.min(cRect.width, rect.width));
  const overlapRatio = xOverlap / minW;
  return (verticalGap <= 110 && overlapRatio > 0.15) || (verticalGap <= 40 && horizontalGap <= 220);
}

function unionRects(rects: DOMRect[]): DOMRect {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
}

function collectChoiceControls(el: Element, baseRect: DOMRect, vw: number, vh: number): DOMRect[] {
  const out: DOMRect[] = [];
  const controls = el.querySelectorAll("input[type='radio'],input[type='checkbox']");
  for (const c of controls) {
    if (!(c instanceof HTMLElement)) continue;
    const r = c.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (!inViewport(r, vw, vh)) continue;
    if (!intersectsRect(r, baseRect)) continue;
    out.push(r);
  }
  return out;
}

function collectBlankControls(el: Element, baseRect: DOMRect, vw: number, vh: number): DOMRect[] {
  const out: DOMRect[] = [];
  const controls = el.querySelectorAll("input:not([type='radio']):not([type='checkbox']):not([type='hidden']):not([type='button']):not([type='submit']),textarea,[contenteditable='true']");
  for (const c of controls) {
    if (!(c instanceof HTMLElement)) continue;
    const r = c.getBoundingClientRect();
    if (r.width < 20 || r.height < 12) continue;
    if (!inViewport(r, vw, vh)) continue;
    if (!intersectsRect(r, baseRect)) continue;
    out.push(r);
  }
  return out;
}

function attachNearbyControls(mainRect: DOMRect, controls: DOMRect[]): DOMRect {
  if (!controls.length) return mainRect;
  const near = controls.filter((c) => {
    const yNear = c.bottom >= mainRect.top - 40 && c.top <= mainRect.bottom + 40;
    const xNear = c.right >= mainRect.left - 160 && c.left <= mainRect.right + 60;
    return yNear && xNear;
  });
  if (!near.length) return mainRect;
  return unionRects([mainRect, ...near]);
}

function attachNearbyBlankControls(mainRect: DOMRect, controls: DOMRect[]): DOMRect {
  if (!controls.length) return mainRect;
  const near = controls.filter((c) => {
    const yNear = c.bottom >= mainRect.top - 80 && c.top <= mainRect.bottom + 240;
    const xNear = c.right >= mainRect.left - 220 && c.left <= mainRect.right + 220;
    return yNear && xNear;
  });
  if (!near.length) return mainRect;
  return unionRects([mainRect, ...near]);
}

function collectMediaRects(el: Element, baseRect: DOMRect, vw: number, vh: number): DOMRect[] {
  const out: DOMRect[] = [];
  const mediaNodes = el.querySelectorAll("img,canvas,svg,math,figure,mjx-container,.MathJax,.katex,embed,table");
  for (const node of mediaNodes) {
    if (!(node instanceof Element)) continue;
    const r = (node as HTMLElement).getBoundingClientRect();
    if (r.width < 24 || r.height < 24) continue;
    if (!inViewport(r, vw, vh)) continue;
    if (!intersectsRect(r, baseRect)) continue;
    out.push(r);
  }
  return out;
}

function attachRelevantMedia(mainRect: DOMRect, mediaRects: DOMRect[], rawText: string): DOMRect {
  if (!mediaRects.length) return mainRect;

  const hasImageCue = /(如图|图示|下图|上图|见图|图中|图甲|图乙|图丙|曲线如图|如下图所示)/.test(rawText);
  const near = mediaRects.filter((m) => {
    const verticalNear = m.bottom >= mainRect.top - 220 && m.top <= mainRect.bottom + 260;
    const horizontalNear = m.right >= mainRect.left - 260 && m.left <= mainRect.right + 260;
    if (!verticalNear || !horizontalNear) return false;
    if (hasImageCue) return true;
    const verticalOverlap = Math.max(0, Math.min(mainRect.bottom, m.bottom) - Math.max(mainRect.top, m.top));
    const overlapRatio = verticalOverlap / Math.max(1, Math.min(mainRect.height, m.height));
    return overlapRatio > 0.08 || Math.abs(m.top - mainRect.bottom) <= 180;
  });

  if (!near.length) return mainRect;
  return unionRects([mainRect, ...near]);
}

function inflateRect(rect: DOMRect, pad: number, clampTo: DOMRect): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.max(clampTo.left, rect.left - pad),
    top: Math.max(clampTo.top, rect.top - pad),
    right: Math.min(clampTo.right, rect.right + pad),
    bottom: Math.min(clampTo.bottom, rect.bottom + pad),
  };
}

function intersectsRect(a: DOMRect, b: DOMRect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function isLikelyActionText(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  return /提交作业|上一题|下一题|返回|标记此题|查看解析|收藏|试题篮|组卷预览|登录|注册|首页/.test(t);
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
