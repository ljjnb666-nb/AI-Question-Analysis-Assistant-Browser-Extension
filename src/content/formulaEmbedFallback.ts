import { isElementNode, isHtmlElementNode } from "./detector/domDetectorShared";
import { decodeFormulaLikeText, normalizeFormulaPlaceholderGlyphs as _normalizeFormulaPlaceholderGlyphs, normalizeMathDisplayText as _normalizeMathDisplayText } from "./formulaTextNormalization";
import {
  extractSemanticSvgLikeText as _extractSemanticSvgLikeText,
  findNearbySemanticFormulaTextForImage as findNearbySemanticFormulaTextForImageBase,
  hasNearbyLargeVisualImageForSemanticNode as _hasNearbyLargeVisualImageForSemanticNode,
} from "./formulaSvgSemantic";

const FORMULA_EMBED_SELECTOR = "embed[data-svg-latex], embed[data-latex]";
const FORMULA_FALLBACK_ATTR = "data-qs-formula-fallback";
const FORMULA_FALLBACK_ID_ATTR = "data-qs-formula-fallback-id";
const FORMULA_PROCESSED_ATTR = "data-qs-formula-processed";
const FORMULA_HIDDEN_ATTR = "data-qs-formula-hidden";

type AttributeSnapshot = { present: boolean; value: string | null };
type FormulaEmbedSnapshot = {
  fallbackId: AttributeSnapshot;
  hidden: AttributeSnapshot;
  processed: AttributeSnapshot;
  display: string;
  appliedFallbackId?: string;
  appliedHidden?: string;
};
type FormulaFallbackSnapshot = {
  fallbackId: string;
  generated: boolean;
  text: string | null;
  style: string | null;
  appliedText: string;
  appliedStyle: string | null;
};
type FormulaFallbackOwner = {
  embeds: Map<Element, FormulaEmbedSnapshot>;
  fallbacks: Map<HTMLElement, FormulaFallbackSnapshot>;
};

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
  return syncFormulaEmbedFallbackForOwner(embed);
}

function syncFormulaEmbedFallbackForOwner(embed: Element, owner?: FormulaFallbackOwner): boolean {
  const text = extractFormulaEmbedText(embed);
  if (!text) return false;

  const parent = embed.parentElement;
  if (!parent) return false;

  if (owner && !owner.embeds.has(embed)) {
    owner.embeds.set(embed, {
      fallbackId: snapshotAttribute(embed, FORMULA_FALLBACK_ID_ATTR),
      hidden: snapshotAttribute(embed, FORMULA_HIDDEN_ATTR),
      processed: snapshotAttribute(embed, FORMULA_PROCESSED_ATTR),
      display: isHtmlElementNode(embed) ? embed.style.display : "",
    });
  }

  const fallbackId = ensureEmbedFallbackId(embed);
  const embedSnapshot = owner?.embeds.get(embed);
  if (embedSnapshot) embedSnapshot.appliedFallbackId = fallbackId;
  let fallback = parent.querySelector<HTMLElement>(`[${FORMULA_FALLBACK_ATTR}="${fallbackId}"]`);
  let generated = false;
  if (!fallback) {
    fallback = document.createElement("span");
    fallback.setAttribute(FORMULA_FALLBACK_ATTR, fallbackId);
    embed.insertAdjacentElement("afterend", fallback);
    generated = true;
  }

  if (owner && !owner.fallbacks.has(fallback)) {
    owner.fallbacks.set(fallback, {
      fallbackId,
      generated,
      text: fallback.textContent,
      style: fallback.getAttribute("style"),
      appliedText: text,
      appliedStyle: null,
    });
  }

  fallback.textContent = text;
  applyFallbackStyles(fallback);
  const fallbackSnapshot = owner?.fallbacks.get(fallback);
  if (fallbackSnapshot) {
    fallbackSnapshot.appliedText = text;
    fallbackSnapshot.appliedStyle = fallback.getAttribute("style");
  }

  if (!embed.hasAttribute(FORMULA_HIDDEN_ATTR) && isHtmlElementNode(embed)) {
    embed.setAttribute(FORMULA_HIDDEN_ATTR, embed.style.display || "");
  }
  if (embedSnapshot && isHtmlElementNode(embed)) {
    embedSnapshot.appliedHidden = embed.getAttribute(FORMULA_HIDDEN_ATTR) ?? "";
  }
  if (isHtmlElementNode(embed)) {
    embed.style.display = "none";
  }
  embed.setAttribute(FORMULA_PROCESSED_ATTR, "1");
  return true;
}

export function installFormulaEmbedFallback(hostname: string = window.location.hostname): () => void {
  if (!shouldInstallFormulaEmbedFallback(hostname)) return () => {};

  let disposed = false;
  const owner: FormulaFallbackOwner = { embeds: new Map(), fallbacks: new Map() };
  for (const embed of Array.from(document.querySelectorAll(FORMULA_EMBED_SELECTOR))) {
    syncFormulaEmbedFallbackForOwner(embed, owner);
  }

  const observer = new MutationObserver((mutations) => {
    if (disposed) return;
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (!isElementNode(added)) continue;
        if (added.matches(FORMULA_EMBED_SELECTOR)) {
          syncFormulaEmbedFallbackForOwner(added, owner);
          continue;
        }
        for (const embed of Array.from(added.querySelectorAll(FORMULA_EMBED_SELECTOR))) {
          syncFormulaEmbedFallbackForOwner(embed, owner);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    restoreFormulaFallback(owner);
  };
}

function restoreFormulaFallback(owner: FormulaFallbackOwner): void {
  for (const [fallback, snapshot] of owner.fallbacks) {
    if (fallback.getAttribute(FORMULA_FALLBACK_ATTR) !== snapshot.fallbackId) continue;
    if (snapshot.generated) {
      fallback.remove();
      continue;
    }
    if (fallback.textContent === snapshot.appliedText) fallback.textContent = snapshot.text;
    if (fallback.getAttribute("style") === snapshot.appliedStyle) restoreAttribute(fallback, "style", { present: snapshot.style !== null, value: snapshot.style });
  }

  for (const [embed, snapshot] of owner.embeds) {
    if (snapshot.appliedHidden !== undefined
      && embed.getAttribute(FORMULA_HIDDEN_ATTR) === snapshot.appliedHidden
      && isHtmlElementNode(embed)
      && embed.style.display === "none") {
      embed.style.display = snapshot.display;
    }
    if (snapshot.appliedFallbackId !== undefined
      && embed.getAttribute(FORMULA_FALLBACK_ID_ATTR) === snapshot.appliedFallbackId
      && !snapshot.fallbackId.present) {
      restoreAttribute(embed, FORMULA_FALLBACK_ID_ATTR, snapshot.fallbackId);
    }
    if (embed.getAttribute(FORMULA_HIDDEN_ATTR) === snapshot.appliedHidden
      && snapshot.appliedHidden !== undefined) {
      restoreAttribute(embed, FORMULA_HIDDEN_ATTR, snapshot.hidden);
    }
    if (embed.getAttribute(FORMULA_PROCESSED_ATTR) === "1") {
      restoreAttribute(embed, FORMULA_PROCESSED_ATTR, snapshot.processed);
    }
  }
}

function snapshotAttribute(element: Element, name: string): AttributeSnapshot {
  return { present: element.hasAttribute(name), value: element.getAttribute(name) };
}

function restoreAttribute(element: Element, name: string, snapshot: AttributeSnapshot): void {
  if (snapshot.present) element.setAttribute(name, snapshot.value ?? "");
  else element.removeAttribute(name);
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
