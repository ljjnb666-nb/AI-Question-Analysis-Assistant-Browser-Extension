/**
 * DOM Detector (rebuilt)
 * - Detects question candidates in viewport
 * - Watches SPA mutations
 * - Filters control-panel/navigation blocks
 */

import type { QuestionBlock, QuestionType, BoundingBox } from "@/shared/types";
import { logWarn } from "@/shared/utils/errorLogger";

const OPTION_RE = /[A-D][\.\):\uFF1A\u3001]/g;
const CIRCLED_RE = /[\u2460\u2461\u2462\u2463]/g;
const QUESTION_RE = /[?\uFF1F]|下列|哪项|正确的是|错误的是|属于|不属于/;

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
  const structuredContainers = detectStructuredQuestionContainers();
  const hasStructuredContainers = structuredContainers.length >= 2;

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

    const text = normalizeText(el.textContent ?? "");
    if (!text || text.length < 10) continue;
    if (isLikelyControlPanelText(text)) continue;

    const guessed = inferQuestionType(text);
    const lockedCardBbox = clampRect(rect, vw, vh);
    const candidate: QuestionBlock = {
      id: `auto-direct-${Date.now()}-${directIndex}-${Math.random().toString(36).slice(2, 8)}`,
      bbox: preferDirectCardMode
        ? applyRightCutToBbox(lockedCardBbox, hostRightCutX)
        : applyRightCutToBbox(refineCandidateRect(el, rect, vw, vh), hostRightCutX),
      previewText: buildPreviewText(el, text).slice(0, 420),
      hasImage: !!el.querySelector("img, canvas, svg, math, figure"),
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

  const elements = collectCandidateElements();
  for (const el of elements) {
    if (preferDirectCardMode) break;
    if (isExtensionUiElement(el)) continue;
    if (hasStructuredContainers && !isInsideAnyContainer(el, structuredContainers)) continue;
    const rawRect = el.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 60 || rect.height < 16) continue;
    if (rect.width * rect.height > viewportArea * 0.75) continue;

    const text = normalizeText(el.textContent ?? "");
    if (!text || text.length < 8 || text.length > 2500) continue;
    if (isLikelyControlPanelText(text)) continue;
    if (isLikelyNavigationElement(el, text)) continue;
    const strongSignal = hasStrongQuestionSignal(text);
    const contextLike = isLikelyQuestionContext(el);
    if (!strongSignal && !contextLike) continue;

    const score = scoreElement(el, text);
    if (score.confidence < 0.35) continue;

    const previewText = buildPreviewText(el, text);
    if (!isLikelyCompleteQuestionText(previewText, score.type)) continue;

    const candidate: QuestionBlock = {
      id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bbox: applyRightCutToBbox(refineCandidateRect(el, rect, vw, vh), hostRightCutX),
      previewText: previewText.slice(0, 420),
      hasImage: score.hasImage,
      questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
      questionTypeGuess: score.type,
      confidence: score.confidence,
      source: "auto_dom",
    };

    const gid = getGroupId(el);
    const rank = completenessScore(candidate.previewText, score.type, score.confidence);
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

  if (/简述|说明|解释|分析|列举/.test(text) && text.length > 30) {
    confidence += 0.15;
    if (type === "unknown") type = "short_answer";
  }

  if (el.querySelector("img, canvas, svg, math, figure")) {
    hasImage = true;
    confidence += 0.1;
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

function hasStrongQuestionSignal(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  const optionCount = (t.match(OPTION_RE) || []).length + (t.match(CIRCLED_RE) || []).length;
  if (optionCount >= 3) return true;
  if (QUESTION_RE.test(t)) return true;
  if (isJudgeLikeText(t)) return true;
  if (/(?:_{2,}|填写|blank|简答|材料题)/i.test(t)) return true;
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

function isInsideAnyContainer(el: Element, containers: Element[]): boolean {
  for (const c of containers) {
    if (c.contains(el)) return true;
  }
  return false;
}

function detectStructuredQuestionContainers(): Element[] {
  const selectors = [
    ".card.mb-3.q-detail.rounded-0",
    ".q-detail",
    ".question-item",
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
      const text = normalizeText(el.textContent || "");
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

  // Keep top-level containers only (drop nested)
  return out.filter((el) => !out.some((other) => other !== el && other.contains(el)));
}

function collectCandidateElements(): Element[] {
  const selectors = [
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
  return String(raw || "").replace(/\s+/g, " ").trim();
}

function buildPreviewText(el: Element, fallbackText: string): string {
  const bodyLike = el.querySelector(".card-body,.q-body,.question-body,.stem,article,section");
  const sourceNode = bodyLike ?? el;
  const normalized = normalizeText(sourceNode.textContent ?? "");
  if (!normalized) return "";

  const pieces = normalized
    .split(/(?=[A-D][\.\):\uFF1A\u3001])|(?=[\u2460\u2461\u2462\u2463])|(?=\d+[\.、\)）])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^(答案\s*[:：]|查看解析|收藏|试题篮|难度\s*[:：])/.test(s));

  const compact = normalizeText(pieces.join(" "));
  return compact.length >= 20 ? compact : fallbackText.slice(0, 420);
}

function findQuestionContainer(el: Element): Element | null {
  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i++) {
    const cls = String((node as HTMLElement).className || "").toLowerCase();
    const id = String((node as HTMLElement).id || "").toLowerCase();
    if (cls.includes("q-detail") || cls.includes("question") || cls.includes("problem") || cls.includes("item") || cls.includes("card") || id.includes("question")) {
      return node;
    }
    node = node.parentElement;
  }
  return el.parentElement;
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
    if (!hasQuestion && text.length < 60) return false;
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
  const sorted = [...blocks].sort((a, b) => b.previewText.length - a.previewText.length);
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
  const aLooksStem = QUESTION_RE.test(aText) || /下列|正确的是|错误的是|如图|图示/.test(aText);
  const bLooksStem = QUESTION_RE.test(bText) || /下列|正确的是|错误的是|如图|图示/.test(bText);

  const complementary = (aHasOptions && bLooksStem) || (bHasOptions && aLooksStem);
  const sameType = a.questionTypeGuess === b.questionTypeGuess || a.questionTypeGuess === "unknown" || b.questionTypeGuess === "unknown";

  return complementary || sameType;
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
    if (!out.some((k) => overlapRatio(k.bbox, b.bbox) > 0.5)) out.push(b);
  }
  return out;
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

function refineCandidateRect(el: Element, baseRect: DOMRect, vw: number, vh: number): BoundingBox {
  const base = clampRect(baseRect, vw, vh);
  const baseArea = Math.max(1, base.width * base.height);
  if (baseArea < 20_000) return base;

  const textItems = collectTextRectItems(el, baseRect, vw, vh);
  const clustered = pickBestQuestionCluster(textItems);
  if (!clustered) return base;

  const controls = collectChoiceControls(el, baseRect, vw, vh);
  const withControls = attachNearbyControls(clustered, controls);
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
  let score = 0;
  if (QUESTION_RE.test(t)) score += 3;
  if ((t.match(OPTION_RE) || []).length > 0) score += 4;
  if ((t.match(CIRCLED_RE) || []).length > 0) score += 3;
  if (/^\d{1,3}[\.、\)）]/.test(t)) score += 3;
  if (/^[A-D][\.\):\uFF1A\u3001]/.test(t)) score += 3;
  if (/单选|多选|判断|填空|简答|题目|选项/.test(t)) score += 2;
  if (/[\u4e00-\u9fa5]/.test(t) && t.length >= 6) score += 1;
  if (/^\d+$/.test(t)) score -= 1;
  return score;
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

function collectMediaRects(el: Element, baseRect: DOMRect, vw: number, vh: number): DOMRect[] {
  const out: DOMRect[] = [];
  const mediaNodes = el.querySelectorAll("img,canvas,svg,math,figure");
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
