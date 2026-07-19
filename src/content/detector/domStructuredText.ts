import type { QuestionDisplaySegment } from "@/shared/types";
import {
  extractSemanticSvgLikeText,
  findNearbySemanticFormulaTextForImage,
  hasNearbyLargeVisualImageForSemanticNode,
} from "../formulaEmbedFallback";
import {
  decodeFormulaLikeText,
  normalizeText,
  trimTrailingQuestionMarker,
} from "./domText";

const FORMULA_FALLBACK_ATTR = "data-qs-formula-fallback";
const FORMULA_HIDDEN_ATTR = "data-qs-formula-hidden";

export function containsMathLikeContent(el: Element, text: string): boolean {
  if (el.querySelector("math, mjx-container, .MathJax, .katex, embed")) return true;
  const t = normalizeText(text).toLowerCase();
  if (!t) return false;
  return /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|lim|sin|cos|tan|e\^|s\^|jω|jw|σ|ω|∫|Σ|√|≤|≥|≠|传递函数|奈奎斯特|伯德图)/i.test(t);
}

export function extractReadableNodeText(node: Element): string {
  const tag = node.tagName.toLowerCase();
  if (node.hasAttribute(FORMULA_FALLBACK_ATTR)) {
    return normalizeText(node.textContent || "");
  }
  if (node.hasAttribute(FORMULA_HIDDEN_ATTR)) {
    return "";
  }
  const attrText = [
    node.getAttribute("aria-label"),
    node.getAttribute("alt"),
    node.getAttribute("title"),
    node.getAttribute("data-alt"),
  ].find((value) => normalizeText(value || ""));

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

export function extractStructuredQuestionText(container: Element): string {
  const pieces: string[] = [];
  const push = (value: string) => {
    const normalized = normalizeText(value);
    if (!normalized) return;
    const next = dedupeJoinedStructuredText([...pieces, normalized]);
    pieces.splice(0, pieces.length, ...next);
  };

  const titleBox = container.querySelector(".title-box,.questionTit,.question-title,[id='title'],[id$='-title'],[id*='question-title']");
  if (titleBox instanceof HTMLElement) {
    push(titleBox.innerText || titleBox.textContent || "");
  }

  const stemNode = container.querySelector(
    ".qeustion-content,.questionContent,.question-content,.stem,.question-body,.content,[id$='-content'],[id='question-content'],[id='content']",
  );
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

export function extractStructuredQuestionDisplaySegments(container: Element): QuestionDisplaySegment[] | undefined {
  const stemNode = container.querySelector(
    ".qeustion-content,.questionContent,.question-content,.stem,.question-body,.content,[id$='-content'],[id='question-content'],[id='content']",
  );
  if (!(stemNode instanceof HTMLElement)) return undefined;

  const segments = buildOrderedDisplaySegments(stemNode, (child) =>
    child.matches(".option-item,.option-content,.optionUl,ul,ol,.sign-box,.flex.items-center.gap-12px"),
  );

  return segments.length ? segments : undefined;
}

function extractOrderedChildContentText(
  node: HTMLElement,
  shouldSkipChild?: (child: Element) => boolean,
): string {
  const orderedPieces = Array.from(node.childNodes)
    .map((child) => readInlineOrderedChildContent(child, shouldSkipChild))
    .filter(Boolean);

  return collapseRepeatedStructuredRun(normalizeText(dedupeJoinedStructuredText(orderedPieces).join("")));
}

function readInlineOrderedChildContent(
  node: Node,
  shouldSkipChild?: (child: Element) => boolean,
): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (!(node instanceof Element)) return "";
  if (shouldSkipChild?.(node)) return "";
  if (node.hasAttribute(FORMULA_HIDDEN_ATTR)) return "";

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
    return text ? `_{${text.replace(/\s+/g, "")}}` : "";
  }
  if (tag === "sup") {
    const text = normalizeText(node.textContent || "");
    return text ? `^{${text.replace(/\s+/g, "")}}` : "";
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

function dedupeJoinedStructuredText(parts: string[]): string[] {
  const deduped: string[] = [];
  for (const part of parts) {
    const text = normalizeText(part);
    if (!text) continue;
    const last = deduped[deduped.length - 1];
    if (!last) {
      deduped.push(text);
      continue;
    }

    let collapsed = false;
    for (let suffixSize = deduped.length; suffixSize >= 2; suffixSize -= 1) {
      const suffix = deduped.slice(-suffixSize).join(" ");
      if (text === suffix || text.includes(suffix)) {
        deduped.splice(deduped.length - suffixSize, suffixSize, text);
        collapsed = true;
        break;
      }
      if (suffix.includes(text)) {
        deduped.splice(deduped.length - suffixSize, suffixSize, suffix);
        collapsed = true;
        break;
      }
    }
    if (collapsed) continue;

    if (text === last) continue;
    if (text.includes(last)) {
      deduped[deduped.length - 1] = text;
      continue;
    }
    if (last.includes(text)) continue;
    deduped.push(text);
  }
  return deduped;
}

function collapseRepeatedStructuredRun(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "";

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 6) return normalized;

  for (let size = Math.floor(tokens.length / 2); size >= 3; size -= 1) {
    const first = tokens.slice(0, size).join(" ");
    const second = tokens.slice(size, size * 2).join(" ");
    if (first !== second) continue;

    const remainder = tokens.slice(size * 2).join(" ");
    return normalizeText(remainder ? `${first} ${remainder}` : first);
  }

  return normalized;
}

function isElementVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (style.opacity === "0") return false;
  if (el.offsetParent !== null) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isExtensionUiElement(el: Element): boolean {
  if ((el as HTMLElement).id?.startsWith("qs-")) return true;
  return !!el.closest?.("[id^='qs-']");
}
