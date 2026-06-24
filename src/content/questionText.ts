import type { BoundingBox } from "@/shared/types";
import {
  decodeFormulaLikeText,
  extractSemanticSvgLikeText,
  findNearbySemanticFormulaTextForImage,
  hasNearbyLargeVisualImageForSemanticNode,
  normalizeMathDisplayText,
} from "./formulaEmbedFallback";

const FORMULA_FALLBACK_ATTR = "data-qs-formula-fallback";
const FORMULA_HIDDEN_ATTR = "data-qs-formula-hidden";
const SEMANTIC_MATH_SELECTOR = "svg,math,mjx-container,.MathJax,.katex,embed,[data-svg-latex],[data-latex]";
const MIXED_CONTENT_HOST_SELECTOR = "p,li,td,label,.option-content,.qeustion-content,.questionContent,.markdown-latex-container";

export function normalizeInlineText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function isSemanticFormulaTextNodeParent(parent: HTMLElement): boolean {
  return Boolean(parent.closest(SEMANTIC_MATH_SELECTOR));
}

export function isSemanticMathElement(node: Element): boolean {
  if (!node) return false;
  if (node.matches(SEMANTIC_MATH_SELECTOR)) return true;
  const tag = node.tagName.toLowerCase();
  return tag === "svg" || tag === "math" || tag === "mjx-container" || tag === "embed";
}

export function shouldSkipNestedSemanticNode(node: Element, container: Element): boolean {
  if (!isSemanticMathElement(node)) return false;
  const host = node.parentElement?.closest(MIXED_CONTENT_HOST_SELECTOR);
  if (!host || host === node || host === container) return false;
  return container.contains(host);
}

export function extractMixedReadableQuestionText(
  node: Element,
  deps: {
    isExtensionUiElement: (el: Element) => boolean;
    normalizeQuestionText: (text: string) => string;
    extractReadableQuestionNodeText: (node: Element) => string;
  },
  depth = 0,
): string {
  if (!node || depth >= 8) {
    return deps.normalizeQuestionText((node as HTMLElement).innerText || node.textContent || "");
  }

  const parts: string[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = normalizeInlineText(child.textContent || "");
      if (text) parts.push(text);
      continue;
    }

    if (!(child instanceof Element) || deps.isExtensionUiElement(child)) continue;
    if (child.hasAttribute(FORMULA_HIDDEN_ATTR)) continue;

    const tag = child.tagName.toLowerCase();
    if (tag === "br") {
      parts.push("\n");
      continue;
    }

    const text =
      isSemanticMathElement(child) || tag === "img" || tag === "canvas"
        ? deps.extractReadableQuestionNodeText(child)
        : extractMixedReadableQuestionText(child, deps, depth + 1);

    if (text) parts.push(text);
  }

  if (!parts.length) {
    return deps.normalizeQuestionText((node as HTMLElement).innerText || node.textContent || "");
  }

  return deps.normalizeQuestionText(
    parts
      .join(" ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

export function isDecorativeQuestionImage(img: Element): boolean {
  const classText = String((img as HTMLElement).className || "");
  const src = String((img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src || "").trim();

  if (img.closest(".option-item") && /icon-lou|aloha-icon|iconfont/i.test(classText)) return true;
  if (/icon-lou|aloha-icon|iconfont|radio|checkbox|select/i.test(classText)) return true;
  if (/689dc301e4b07b838da42b38\.png/i.test(src)) return true;

  const rect = (img as HTMLElement).getBoundingClientRect?.();
  if (rect && rect.width <= 28 && rect.height <= 28) return true;

  return false;
}

export function extractReadableQuestionNodeText(
  node: Element,
  deps: {
    isExtensionUiElement: (el: Element) => boolean;
    normalizeQuestionText: (text: string) => string;
  },
): string {
  const tag = node.tagName.toLowerCase();
  if (node.hasAttribute(FORMULA_FALLBACK_ATTR)) {
    return deps.normalizeQuestionText(node.textContent || "");
  }
  if (node.hasAttribute(FORMULA_HIDDEN_ATTR)) {
    return "";
  }
  const attrText = [
    node.getAttribute("aria-label"),
    node.getAttribute("alt"),
    node.getAttribute("title"),
    node.getAttribute("data-alt"),
  ].find((v) => deps.normalizeQuestionText(v || ""));

  if (tag === "img") {
    if (isDecorativeQuestionImage(node)) return "";
    if (findNearbySemanticFormulaTextForImage(node)) return "";
    return deps.normalizeQuestionText(attrText || "[图片]");
  }
  if (tag === "embed") {
    const latex = decodeFormulaLikeText(
      node.getAttribute("data-svg-latex")
      || node.getAttribute("data-latex")
      || node.getAttribute("alt")
      || node.getAttribute("title")
      || "",
    );
    return deps.normalizeQuestionText(latex || attrText || "[公式]");
  }
  if (tag === "canvas") {
    return deps.normalizeQuestionText(attrText || "[图形]");
  }
  if (tag === "svg" || tag === "math" || tag === "mjx-container") {
    if (hasNearbyLargeVisualImageForSemanticNode(node)) return "";
    return deps.normalizeQuestionText(extractSemanticSvgLikeText(node) || "[公式]");
  }
  if (node.matches(".MathJax, .katex")) {
    if (hasNearbyLargeVisualImageForSemanticNode(node)) return "";
    return deps.normalizeQuestionText(extractSemanticSvgLikeText(node) || "[公式]");
  }
  return extractMixedReadableQuestionText(node, {
    ...deps,
    extractReadableQuestionNodeText: (child) => extractReadableQuestionNodeText(child, deps),
  }) || deps.normalizeQuestionText((node as HTMLElement).innerText || node.textContent || attrText || "");
}

export function mergeTextEntries(
  entries: Array<{ top: number; left: number; text: string }>,
  normalizeQuestionText: (text: string) => string,
): string {
  if (entries.length === 0) return "";
  entries.sort((a, b) => (a.top - b.top) || (a.left - b.left));

  const lines: string[] = [];
  let currentTop = entries[0].top;
  let currentLineParts: string[] = [];
  const lineThreshold = 8;

  for (const entry of entries) {
    if (Math.abs(entry.top - currentTop) > lineThreshold) {
      const lineText = normalizeInlineText(currentLineParts.join(" "));
      if (lineText) lines.push(lineText);
      currentLineParts = [entry.text];
      currentTop = entry.top;
    } else {
      const prev = currentLineParts[currentLineParts.length - 1];
      if (prev !== entry.text) currentLineParts.push(entry.text);
    }
  }

  const lastLine = normalizeInlineText(currentLineParts.join(" "));
  if (lastLine) lines.push(lastLine);

  const dedupedLines: string[] = [];
  for (const line of lines) {
    if (dedupedLines[dedupedLines.length - 1] !== line) dedupedLines.push(line);
  }
  return normalizeQuestionText(dedupedLines.join("\n"));
}

export function rectIntersectsBBox(rect: DOMRect, bbox: BoundingBox): boolean {
  const x1 = Math.max(rect.left, bbox.x);
  const y1 = Math.max(rect.top, bbox.y);
  const x2 = Math.min(rect.right, bbox.x + bbox.width);
  const y2 = Math.min(rect.bottom, bbox.y + bbox.height);
  return x2 > x1 && y2 > y1;
}

export function intersectionArea(rect: DOMRect, bbox: BoundingBox): number {
  const x1 = Math.max(rect.left, bbox.x);
  const y1 = Math.max(rect.top, bbox.y);
  const x2 = Math.min(rect.right, bbox.x + bbox.width);
  const y2 = Math.min(rect.bottom, bbox.y + bbox.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

export function isElementVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null) return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (style.opacity === "0") return false;
  return true;
}

export function isExtensionUiElement(el: Element): boolean {
  if ((el.id && el.id.startsWith("qs-")) || !!el.closest("[id^='qs-']")) return true;
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    const hostId = root.host?.id ?? "";
    if (hostId.startsWith("qs-")) return true;
  }
  return false;
}

export function normalizeQuestionText(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !isNoiseLine(line));
  const cleaned = lines.join("\n");
  return normalizeMathDisplayText(stripLikelyTrailingCodeOrJson(cleaned));
}

export function isNoiseLine(line: string): boolean {
  const t = String(line || "").trim();
  if (!t) return true;
  if (/^```/.test(t)) return true;
  if (/^(?:\{|\}|\[|\]|\"questionType\"|\"answer\"|\"confidence\"|\"recognizedText\"|\"warning\")/.test(t)) return true;
  if (/[.#]?[a-zA-Z0-9_-]+\s*\{\s*(?:fill|stroke|font-family|line-join|linecap|width|height)\s*:/i.test(t)) return true;
  if (/^(?:fill|stroke|font-family|stroke-width|stroke-linejoin|stroke-linecap)\s*:/i.test(t)) return true;
  if (/(?:svg|path|stroke|fill)\s*[:=]/i.test(t) && /[{;}]/.test(t)) return true;
  if (t.length > 180 && /[{;}:]/.test(t) && /(rgb\(|font-family|stroke|fill)/i.test(t)) return true;
  return false;
}

export function stripLikelyTrailingCodeOrJson(text: string): string {
  const t = String(text || "");
  if (!t) return t;
  const cutMarkers = ["```json", "```", "[", "{\n\"questionType\"", "\"questionType\":"];
  let cut = -1;
  for (const marker of cutMarkers) {
    const idx = t.indexOf(marker);
    if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
  }
  return cut >= 0 ? t.slice(0, cut).trim() : t.trim();
}

export function hasLikelyMultipleQuestionStarts(text: string): boolean {
  const t = String(text || "");
  if (!t) return false;
  const starts = t.match(/(?:^|\n)\s*(?:\d{1,2}[、\.\)]|[（(]\d{1,2}[)）]|第\s*\d+\s*题)/g) || [];
  return starts.length >= 2;
}

export function looksLikeQuestionBlock(text: string): boolean {
  if (text.length < 20) return false;
  const hasQuestion = /[?\uFF1F]/.test(text);
  const optionLikeCount = (
    text.match(/(?:^|\n)\s*(?:[A-D][\.\):\uFF1A\u3001]?|[\u2460\u2461\u2462\u2463])\s*/g) || []
  ).length;
  return hasQuestion && optionLikeCount >= 2;
}

export function scoreQuestionLikeText(text: string, node: Element, depth: number): number {
  if (!text) return -1000;
  const len = text.length;
  const optionLikeCount = (
    text.match(/(?:^|\n)\s*(?:[A-D][\.\):\uFF1A\u3001]?|[\u2460\u2461\u2462\u2463])\s*/g) || []
  ).length;
  const hasQuestion = /[?\uFF1F]/.test(text);
  const isRootNode = node.tagName === "BODY" || node.tagName === "HTML";
  const lineCount = text.split("\n").length;

  let score = 0;
  if (hasQuestion) score += 40;
  score += optionLikeCount * 30;
  if (looksLikeQuestionBlock(text)) score += 60;
  if (len >= 80 && len <= 900) score += 35;
  if (len > 1500) score -= 120;
  if (lineCount > 60) score -= 30;
  if (isRootNode) score -= 80;
  score -= depth * 4;
  return score;
}

export function collectTextFromContainer(
  container: Element,
  bbox: BoundingBox,
  deps: {
    extractReadableQuestionNodeText: (node: Element) => string;
    intersectionArea: (rect: DOMRect, bbox: BoundingBox) => number;
    isElementVisible: (el: HTMLElement) => boolean;
    isExtensionUiElement: (el: Element) => boolean;
  },
): string {
  const selector = "h1,h2,h3,h4,p,li,td,label,img,svg,math,figure,mjx-container,.MathJax,.katex,embed,.option-content,.qeustion-content,.questionContent,.markdown-latex-container";
  const nodes = Array.from(container.querySelectorAll(selector));
  const entries: Array<{ top: number; left: number; text: string }> = [];

  for (const node of nodes) {
    if (deps.isExtensionUiElement(node)) continue;
    if (shouldSkipNestedSemanticNode(node, container)) continue;
    if (node instanceof HTMLElement && !deps.isElementVisible(node)) continue;
    const rect = node.getBoundingClientRect();
    const interArea = deps.intersectionArea(rect, bbox);
    if (interArea < 8) continue;
    if (rect.width < 2 || rect.height < 2) continue;

    const text = deps.extractReadableQuestionNodeText(node);
    if (!text || text.length > 320) continue;
    entries.push({ top: rect.top, left: rect.left, text });
  }

  return mergeTextEntries(entries, normalizeQuestionText);
}

export function collectTextFromRegion(
  bbox: BoundingBox,
  deps: {
    extractReadableQuestionNodeText: (node: Element) => string;
    intersectionArea: (rect: DOMRect, bbox: BoundingBox) => number;
    isElementVisible: (el: HTMLElement) => boolean;
    isExtensionUiElement: (el: Element) => boolean;
  },
): string {
  const textEntries: Array<{ top: number; left: number; text: string }> = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const parent = textNode.parentElement;
    const rawText = textNode.textContent ?? "";
    if (
      parent &&
      !deps.isExtensionUiElement(parent) &&
      rawText.trim().length > 0 &&
      deps.isElementVisible(parent) &&
      !isSemanticFormulaTextNodeParent(parent)
    ) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = Array.from(range.getClientRects());
      range.detach?.();

      let bestRect: DOMRect | null = null;
      let bestArea = 0;
      for (const rect of rects) {
        const area = deps.intersectionArea(rect, bbox);
        if (area > bestArea) {
          bestArea = area;
          bestRect = rect;
        }
      }

      if (bestRect && bestArea >= 4) {
        const text = normalizeInlineText(rawText);
        if (text) {
          textEntries.push({ top: bestRect.top, left: bestRect.left, text });
        }
      }
    }
    current = walker.nextNode();
  }

  const mergedFromTextNodes = mergeTextEntries(textEntries, normalizeQuestionText);
  if (looksLikeQuestionBlock(mergedFromTextNodes)) return mergedFromTextNodes.slice(0, 1200);

  const selector = "h1,h2,h3,h4,p,li,td,label,span,img,svg,math,figure,mjx-container,.MathJax,.katex,embed";
  const nodes = Array.from(document.querySelectorAll(selector));
  const entries: Array<{ top: number; left: number; text: string }> = [];

  for (const node of nodes) {
    if (deps.isExtensionUiElement(node)) continue;
    if (node instanceof HTMLElement) {
      if (node.offsetParent === null) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") continue;
    }

    const rect = node.getBoundingClientRect();
    if (!rectIntersectsBBox(rect, bbox)) continue;
    if (rect.width < 2 || rect.height < 2) continue;

    const text = deps.extractReadableQuestionNodeText(node);
    if (!text || text.length > 220) continue;
    entries.push({ top: rect.top, left: rect.left, text });
  }

  return mergeTextEntries(entries, normalizeQuestionText).slice(0, 1200);
}

export function extractRichQuestionPreviewFromElement(
  node: Element,
  deps: {
    collectTextFromContainer: (container: Element, bbox: BoundingBox) => string;
    extractReadableQuestionNodeText: (node: Element) => string;
    isExtensionUiElement: (el: Element) => boolean;
    normalizeQuestionText: (text: string) => string;
  },
): string {
  if (!node || deps.isExtensionUiElement(node)) return "";
  const rect = node.getBoundingClientRect();
  const bbox: BoundingBox = {
    x: Math.max(0, rect.left),
    y: Math.max(0, rect.top),
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };

  let text = "";
  if (rect.width >= 2 && rect.height >= 2) {
    text = deps.collectTextFromContainer(node, bbox);
  }
  if (!text) {
    text = deps.extractReadableQuestionNodeText(node);
  }
  if (!text) {
    text = deps.normalizeQuestionText((node as HTMLElement).innerText || node.textContent || "");
  }
  return deps.normalizeQuestionText(text);
}
