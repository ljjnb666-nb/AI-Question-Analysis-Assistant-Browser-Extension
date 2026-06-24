import type { BoundingBox } from "@/shared/types";
import {
  extractReadableNodeText,
} from "./domStructuredText";
import { normalizeText, sanitizePreviewText } from "./domText";
import { bboxIntersectsRect, isExtensionUiElement, isLikelyActionText, isLikelyControlPanelText } from "./domDetectorShared";

export function getElementReadableText(el: Element): string {
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

export function buildPreviewText(el: Element, fallbackText: string): string {
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

export function buildPreviewTextForBbox(el: Element, bbox: BoundingBox, fallbackText: string): string {
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
