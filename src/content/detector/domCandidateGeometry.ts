import type { BoundingBox, QuestionType } from "@/shared/types";
import { CIRCLED_RE, OPTION_RE, QUESTION_RE, normalizeText } from "./domText";

type RectItem = { rect: DOMRect; text: string; score: number };

type GeometryDeps = {
  bboxIntersectsRect: (bbox: BoundingBox, rect: DOMRect) => boolean;
  clampRect: (rect: DOMRect, vw: number, vh: number) => BoundingBox;
  inViewport: (rect: DOMRect, vw: number, vh: number) => boolean;
  isExtensionUiElement: (el: Element) => boolean;
};

export function refineCandidateRect(
  el: Element,
  baseRect: DOMRect,
  vw: number,
  vh: number,
  deps: GeometryDeps,
): BoundingBox {
  const base = deps.clampRect(baseRect, vw, vh);
  const baseArea = Math.max(1, base.width * base.height);
  if (baseArea < 20_000) return base;

  const textItems = collectTextRectItems(el, baseRect, vw, vh, deps);
  const clustered = pickBestQuestionCluster(textItems);
  if (!clustered) return base;

  const controls = collectChoiceControls(el, baseRect, vw, vh, deps);
  const blankControls = collectBlankControls(el, baseRect, vw, vh, deps);
  const withChoiceControls = attachNearbyControls(clustered, controls);
  const withControls = attachNearbyBlankControls(withChoiceControls, blankControls);
  const mediaRects = collectMediaRects(el, baseRect, vw, vh, deps);
  const withMedia = attachRelevantMedia(withControls, mediaRects, normalizeText(el.textContent ?? ""));
  const refinedRect = inflateRect(withMedia, 10, baseRect);
  const refined: BoundingBox = {
    x: Math.max(0, refinedRect.left),
    y: Math.max(0, refinedRect.top),
    width: Math.max(20, Math.min(vw, refinedRect.right) - Math.max(0, refinedRect.left)),
    height: Math.max(20, Math.min(vh, refinedRect.bottom) - Math.max(0, refinedRect.top)),
  };

  const refinedArea = Math.max(1, refined.width * refined.height);
  if (refinedArea < baseArea * 0.08) return base;
  if (refinedArea > baseArea * 0.98) return base;
  return refined;
}

export function refineBboxForDetectedType(
  el: Element,
  bbox: BoundingBox,
  type: QuestionType,
  vw: number,
  vh: number,
  deps: GeometryDeps,
): BoundingBox {
  if (type === "judge") {
    return refineJudgeCandidateRect(el, bbox, vw, vh, deps);
  }
  return bbox;
}

function refineJudgeCandidateRect(
  el: Element,
  bbox: BoundingBox,
  vw: number,
  vh: number,
  deps: GeometryDeps,
): BoundingBox {
  const relevantRects: DOMRect[] = [];
  const nodes = el.querySelectorAll("div,p,li,label,span,input");

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (deps.isExtensionUiElement(node)) continue;
    if (node === el) continue;

    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (!deps.inViewport(rect, vw, vh)) continue;
    if (!deps.bboxIntersectsRect(bbox, rect)) continue;
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

function collectTextRectItems(
  el: Element,
  baseRect: DOMRect,
  vw: number,
  vh: number,
  deps: GeometryDeps,
): RectItem[] {
  const items: RectItem[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (!parent || deps.isExtensionUiElement(parent)) {
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
      if (!deps.inViewport(r, vw, vh)) continue;
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

function collectChoiceControls(el: Element, baseRect: DOMRect, vw: number, vh: number, deps: GeometryDeps): DOMRect[] {
  const out: DOMRect[] = [];
  const controls = el.querySelectorAll("input[type='radio'],input[type='checkbox']");
  for (const c of controls) {
    if (!(c instanceof HTMLElement)) continue;
    const r = c.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (!deps.inViewport(r, vw, vh)) continue;
    if (!intersectsRect(r, baseRect)) continue;
    out.push(r);
  }
  return out;
}

function collectBlankControls(el: Element, baseRect: DOMRect, vw: number, vh: number, deps: GeometryDeps): DOMRect[] {
  const out: DOMRect[] = [];
  const controls = el.querySelectorAll("input:not([type='radio']):not([type='checkbox']):not([type='hidden']):not([type='button']):not([type='submit']),textarea,[contenteditable='true']");
  for (const c of controls) {
    if (!(c instanceof HTMLElement)) continue;
    const r = c.getBoundingClientRect();
    if (r.width < 20 || r.height < 12) continue;
    if (!deps.inViewport(r, vw, vh)) continue;
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

function collectMediaRects(el: Element, baseRect: DOMRect, vw: number, vh: number, deps: GeometryDeps): DOMRect[] {
  const out: DOMRect[] = [];
  const mediaNodes = el.querySelectorAll("img,canvas,svg,math,figure,mjx-container,.MathJax,.katex,embed,table");
  for (const node of mediaNodes) {
    if (!(node instanceof Element)) continue;
    const r = (node as HTMLElement).getBoundingClientRect();
    if (r.width < 24 || r.height < 24) continue;
    if (!deps.inViewport(r, vw, vh)) continue;
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
