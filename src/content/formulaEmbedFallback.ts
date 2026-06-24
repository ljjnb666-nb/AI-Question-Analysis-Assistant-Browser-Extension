import { decodeFormulaLikeText, normalizeFormulaPlaceholderGlyphs, normalizeMathDisplayText } from "./formulaTextNormalization";
import {
  extractSemanticSvgLikeText,
  findNearbySemanticFormulaTextForImage as findNearbySemanticFormulaTextForImageBase,
  hasNearbyLargeVisualImageForSemanticNode,
} from "./formulaSvgSemantic";

const FORMULA_EMBED_SELECTOR = "embed[data-svg-latex], embed[data-latex]";
const FORMULA_FALLBACK_ATTR = "data-qs-formula-fallback";
const FORMULA_FALLBACK_ID_ATTR = "data-qs-formula-fallback-id";
const FORMULA_PROCESSED_ATTR = "data-qs-formula-processed";
const FORMULA_HIDDEN_ATTR = "data-qs-formula-hidden";

export function shouldInstallFormulaEmbedFallback(hostname: string = window.location.hostname): boolean {
  return /(^|\.)zhihuishu\.com$/i.test(hostname);
}

export { decodeFormulaLikeText, normalizeFormulaPlaceholderGlyphs, normalizeMathDisplayText } from "./formulaTextNormalization";
export { extractSemanticSvgLikeText, hasNearbyLargeVisualImageForSemanticNode } from "./formulaSvgSemantic";

export function extractFormulaEmbedText(embed: Element): string {
  return decodeFormulaLikeText(
    embed.getAttribute("data-svg-latex")
    || embed.getAttribute("data-latex")
    || embed.getAttribute("alt")
    || embed.getAttribute("title")
    || "",
  );
}

export function findNearbySemanticFormulaTextForImage(img: Element): string {
  return findNearbySemanticFormulaTextForImageBase(img, extractFormulaEmbedText);
}

export function processFormulaEmbeds(root: ParentNode = document): number {
  const embeds = Array.from(root.querySelectorAll(FORMULA_EMBED_SELECTOR));
  let changed = 0;
  for (const embed of embeds) {
    if (syncFormulaEmbedFallback(embed)) changed += 1;
  }
  return changed;
}

export function syncFormulaEmbedFallback(embed: Element): boolean {
  const text = extractFormulaEmbedText(embed);
  if (!text) return false;

  const parent = embed.parentElement;
  if (!parent) return false;

  const fallbackId = ensureEmbedFallbackId(embed);
  let fallback = parent.querySelector<HTMLElement>(`[${FORMULA_FALLBACK_ATTR}="${fallbackId}"]`);
  if (!fallback) {
    fallback = document.createElement("span");
    fallback.setAttribute(FORMULA_FALLBACK_ATTR, fallbackId);
    embed.insertAdjacentElement("afterend", fallback);
  }

  fallback.textContent = text;
  applyFallbackStyles(fallback);

  if (!embed.hasAttribute(FORMULA_HIDDEN_ATTR) && embed instanceof HTMLElement) {
    embed.setAttribute(FORMULA_HIDDEN_ATTR, embed.style.display || "");
  }
  if (embed instanceof HTMLElement) {
    embed.style.display = "none";
  }
  embed.setAttribute(FORMULA_PROCESSED_ATTR, "1");
  return true;
}

export function installFormulaEmbedFallback(): () => void {
  if (!shouldInstallFormulaEmbedFallback()) return () => {};

  processFormulaEmbeds(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (!(added instanceof Element)) continue;
        if (added.matches(FORMULA_EMBED_SELECTOR)) {
          syncFormulaEmbedFallback(added);
          continue;
        }
        processFormulaEmbeds(added);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => observer.disconnect();
}

function ensureEmbedFallbackId(embed: Element): string {
  const existing = embed.getAttribute(FORMULA_FALLBACK_ID_ATTR);
  if (existing) return existing;
  const id = `qs-formula-${Math.random().toString(36).slice(2, 10)}`;
  embed.setAttribute(FORMULA_FALLBACK_ID_ATTR, id);
  return id;
}

function applyFallbackStyles(el: HTMLElement) {
  el.style.display = "inline-block";
  el.style.verticalAlign = "middle";
  el.style.whiteSpace = "nowrap";
  el.style.fontFamily = "\"Cambria Math\", \"Times New Roman\", serif";
  el.style.fontStyle = "italic";
  el.style.fontSize = "1em";
  el.style.lineHeight = "1.2";
  el.style.color = "inherit";
  el.style.margin = "0 0.12em";
}
