import { bboxIntersectsRect, isElementVisible, isExtensionUiElement, isHtmlElementNode, isLikelyActionText as _isLikelyActionText, isLikelyControlPanelText } from "./domDetectorShared";
/**
 * DOM Detector (rebuilt)
 * - Detects question candidates in viewport
 * - Watches SPA mutations
 * - Filters control-panel/navigation blocks
 */

import type { QuestionBlock, QuestionType, BoundingBox, QuestionDisplaySegment, DomCandidateDiagnostics } from "@/shared/types";
import { logWarn } from "@/shared/utils/errorLogger";
import {
  applyRightCutToRect,
  boundaryFromRawRect,
  clampRect,
  clampRectToBbox,
  getVisibleVerticalRatio,
  inViewport,
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
import {
  completenessScore,
  deduplicateBlocks,
  filterFragmentBlocks,
  isLikelyCompleteQuestionText,
  mergeAdjacentQuestionBlocks,
  withQuestionCompleteness,
} from "./domDetectorPostprocess";
import { buildPreviewText, buildPreviewTextForBbox, getElementReadableText } from "./domDetectorPreview";
import { recoverStructuralChoiceLabels } from "./structuralChoiceLabels";
import { hasMeaningfulVisualContent, pickQuestionImageFromElement } from "./domDetectorVisual";
import { startQuestionRevisionWatch } from "../revision/questionRevisionWatch";
import { MAX_SHADOW_HOST_PROBES, type RootContext } from "../roots/rootContext";
import { isOpenShadowRootNode } from "../domRealm";
import { createTopViewportProjector, sharedRootRegistry } from "../roots/rootRegistry";
import type { TraversableRoot } from "../roots/rootDom";
import { bindDomQuestionBlockToOwner as attachDetectedQuestionIdentity } from "../domQuestionBinding";
import { runSiteAdapters } from "./adapters";

let rootCandidateObservationSequence = 0;

function nextRootCandidateObservationId(): string {
  return `auto-root-${Date.now()}-${++rootCandidateObservationSequence}`;
}

export function watchForPageChanges(
  callback: (blocks: QuestionBlock[], rootKey?: string) => void,
): () => void {
  return startQuestionRevisionWatch({
    detectCandidates: detectCandidatesInViewport,
    onCandidates: callback,
    detectRootCandidates: detectCandidatesInRoot,
  });
}

/**
 * Detection across every accessible root: reconciles the registry, scans the
 * top document plus all registered same-origin frames and open shadow roots,
 * and dedupes runtime instances by root-scoped identity.
 */
export function detectCandidatesAcrossRoots(diagnostics?: DomCandidateDiagnostics): QuestionBlock[] {
  return appendAccessibleRootCandidates(detectCandidatesInViewport(diagnostics));
}

/** Reuse the existing bounded root registry for a full-page viewport probe. */
function appendAccessibleRootCandidates(topCandidates: QuestionBlock[], diagnostics?: DomCandidateDiagnostics): QuestionBlock[] {
  const registry = sharedRootRegistry();
  registry.reconcile(document);
  const merged: QuestionBlock[] = [...topCandidates];
  const seen = new Set(merged.map((block) => `${block.identity?.stableId ?? block.id}`));
  for (const root of registry.list()) {
    if (root.kind === "top-document") continue;
    let blocks: QuestionBlock[] = [];
    try {
      blocks = detectCandidatesInRoot(root.root, root, diagnostics);
    } catch (err) {
      logWarn("Root detection failed", "detectCandidatesAcrossRoots", { error: String(err) });
    }
    for (const block of blocks) {
      const instanceKey = `${root.rootKey} ${block.identity?.stableId ?? block.id}`;
      if (seen.has(instanceKey)) continue;
      seen.add(instanceKey);
      merged.push(block);
    }
  }
  return merged.sort((a, b) => a.bbox.y - b.bbox.y);
}

/** Numeric-only diagnostics; each viewport may be probed again after a bounded readiness retry. */
export function createDomCandidateDiagnostics(): DomCandidateDiagnostics {
  return { probedElements: 0, acceptedCandidates: 0,
    rejected: { geometry: 0, text: 0, controls: 0, navigation: 0, signal: 0, confidence: 0, completeness: 0, grouped: 0, fragment: 0, duplicate: 0 } };
}

export function detectCandidatesInViewport(
  diagnostics?: DomCandidateDiagnostics,
  options?: { includeAccessibleRoots?: boolean },
): QuestionBlock[] {
  const probe = () => { if (diagnostics) diagnostics.probedElements++; };
  const reject = (reason: keyof DomCandidateDiagnostics["rejected"]) => {
    if (diagnostics) diagnostics.rejected[reason]++;
  };
  const finish = (blocks: QuestionBlock[]) => {
    // Only full-page scanning opts in. The normal viewport and revision-watch
    // contracts keep their existing root-local semantics.
    const collected = options?.includeAccessibleRoots ? appendAccessibleRootCandidates(blocks, diagnostics) : blocks;
    if (diagnostics) diagnostics.acceptedCandidates += collected.length;
    return collected;
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const viewportArea = Math.max(1, vw * vh);
  const hostRightCutX = getHostRightSidebarCutX(vw, vh);
  const stableQuestionCards = getStableQuestionCardContainers();
  const structuredContainers = detectStructuredQuestionContainers();
  const hasStructuredContainers = structuredContainers.length >= 1;
  const adapterCtx = { hostRightCutX, vw, vh, diagnostics };

  const grouped = new Map<string, QuestionBlock>();
  const groupRank = new Map<string, number>();
  const ownerKeyMap = new WeakMap<Element, string>();
  let ownerCounter = 0;

  const getGroupId = (el: Element): string => {
    const container = findQuestionContainer(el) ?? el;
    const existing = ownerKeyMap.get(container);
    if (existing) return existing;
    const id = `owner-${++ownerCounter}`;
    ownerKeyMap.set(container, id);
    return id;
  };

  const directCardBodies = Array.from(document.querySelectorAll(".card.mb-3.q-detail.rounded-0 .card-body"));
  const preferDirectCardMode = directCardBodies.length >= 1;
  for (const [directIndex, el] of directCardBodies.entries()) {
    if (isExtensionUiElement(el)) continue;
    probe();
    const structuredHost = el.querySelector(".question-item, .questionBox, .base-question-component");
    const rectSource =(isHtmlElementNode(structuredHost) ? structuredHost : el) as HTMLElement;
    const rawRect = rectSource.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect || !inViewport(rect, vw, vh) || rect.width < 80 || rect.height < 16) { reject("geometry"); continue; }

    const text = structuredHost
      ? extractStructuredQuestionText(structuredHost)
      : getElementReadableText(el);
    if (!text || text.length < 10) { reject("text"); continue; }
    if (isLikelyControlPanelText(text)) { reject("controls"); continue; }

    let candidateBbox = applyRightCutToBbox(refineCandidateRect(rectSource, rect, vw, vh), hostRightCutX);
    let previewText = buildPreviewTextForBbox(el, candidateBbox, text);
    const guessed = inferQuestionType(previewText || text);
    candidateBbox = refineBboxForDetectedType(rectSource, candidateBbox, guessed, vw, vh);
    previewText = structuredHost
      ? sanitizePreviewTextByType(text, guessed)
      : sanitizePreviewTextByType(buildPreviewTextForBbox(el, candidateBbox, text), guessed);
    if (!isLikelyCompleteQuestionText(previewText, guessed)) { reject("completeness"); continue; }
    const candidate = attachDetectedQuestionIdentity({
      id: `auto-direct-${Date.now()}-${directIndex}-${Math.random().toString(36).slice(2, 8)}`,
      bbox: candidateBbox,
      previewText: previewText.slice(0, 420),
      displaySegments: structuredHost ? extractStructuredQuestionDisplaySegments(structuredHost) : undefined,
      hasImage: hasMeaningfulVisualContent(rectSource),
      questionImageUrl: pickQuestionImageFromElement(rectSource) ?? undefined,
      questionTypeGuess: guessed,
      confidence: 0.9,
      source: "auto_dom",
      identitySourceText: text,
      runtimeOwnerKey: `direct-card-${directIndex}`,
      boundary: boundaryFromRawRect(rawRect, vh),
    }, rectSource, { identityText: text });

    const gid = `direct-card-${directIndex}`;
    const rank = completenessScore(candidate.previewText, candidate.questionTypeGuess, candidate.confidence) + 20;
    const prev = groupRank.get(gid) ?? -Infinity;
    if (rank > prev) {
      groupRank.set(gid, rank);
      grouped.set(gid, candidate);
    }
  }

  // An unrelated or not-yet-visible direct-card shell must not suppress
  // valid question cards or the generic candidate detector.
  const hasAcceptedDirectCard = preferDirectCardMode && grouped.size > 0;
  if (!hasAcceptedDirectCard) {
    // Strangler: site adapters plug in here by phase; unmatched pages fall
    // through to the generic path below. Interleaving with the structured-
    // container path is preserved via adapter phases.
    const takeoverCtx = { hasStructuredContainers, hasAcceptedDirectCard };
    const preBlocks = runSiteAdapters(adapterCtx, takeoverCtx, "pre-structured");
    if (preBlocks) {
      return finish(filterFragmentBlocks(deduplicateBlocks(preBlocks, diagnostics).sort((a, b) => a.bbox.y - b.bbox.y), diagnostics).map(withQuestionCompleteness));
    }
    const stableContainerBlocks = buildStableStructuredContainerCandidates(stableQuestionCards, hostRightCutX, vw, vh);
    if (diagnostics) diagnostics.probedElements += stableQuestionCards.length;
    if (stableContainerBlocks.length > 0) {
      return finish(filterFragmentBlocks(deduplicateBlocks(stableContainerBlocks, diagnostics).sort((a, b) => a.bbox.y - b.bbox.y), diagnostics).map(withQuestionCompleteness));
    }
    const postBlocks = runSiteAdapters(adapterCtx, takeoverCtx, "post-structured");
    if (postBlocks) {
      return finish(filterFragmentBlocks(deduplicateBlocks(postBlocks, diagnostics).sort((a, b) => a.bbox.y - b.bbox.y), diagnostics).map(withQuestionCompleteness));
    }
  }

  const elements = collectCandidateElements();
  if (!hasAcceptedDirectCard) {
    // First honor structural boundaries. If they yield ZERO candidates,
    // recover only credible independent question stems from outside the
    // unrelated structure. Never let menu-like A/B/C/D alone gain authority.
    for (const enforceStructuredBoundary of hasStructuredContainers ? [true, false] : [false]) {
      for (const el of elements) {
        if (isExtensionUiElement(el)) continue;
        if (enforceStructuredBoundary && !isInsideAnyContainer(el, structuredContainers)) continue;
        if (enforceStructuredBoundary && structuredContainers.some((container) => container !== el && el.contains(container))) continue;
        probe();
        const rawRect = el.getBoundingClientRect();
        const rect = applyRightCutToRect(rawRect, hostRightCutX);
        if (!rect || !inViewport(rect, vw, vh) || rect.width < 60 || rect.height < 16
          || rect.width * rect.height > viewportArea * 0.75) { reject("geometry"); continue; }

        const text = getElementReadableText(el);
        if (!text || text.length < 8 || text.length > 2500) { reject("text"); continue; }
        if (isLikelyControlPanelText(text)) { reject("controls"); continue; }
        if (hasStructuredContainers && !enforceStructuredBoundary
          && !/(?:[?？]|下列|哪项|正确的是|错误的是|属于|不属于|^\s*(?:第\s*\d{1,3}\s*题|\d{1,3}[.、)）]))/.test(text)) { reject("signal"); continue; }
        if (isLikelyNavigationElement(el, text)) { reject("navigation"); continue; }
        const strongSignal = hasStrongQuestionSignal(text);
        const contextLike = isLikelyQuestionContext(el);
        if (!strongSignal && !contextLike) { reject("signal"); continue; }

        const score = scoreElement(el, text);
        if (score.confidence < 0.35) { reject("confidence"); continue; }

        // Once a single bounded card proves four independent owned labels,
        // keep its *full visible card* as the preview authority. Clustering
        // only the stem's text rect would silently clip out valid options.
        // This exception is not available to page shells, menus or mixed cards.
        const hasOwnedChoiceStructure = recoverStructuralChoiceLabels(el) !== null;
        let candidateBbox = applyRightCutToBbox(
          hasOwnedChoiceStructure ? clampRect(rect, vw, vh) : refineCandidateRect(el, rect, vw, vh),
          hostRightCutX,
        );
        let previewText = buildPreviewTextForBbox(el, candidateBbox, text);
        const previewType = inferQuestionType(previewText || text);
        const candidateType = previewType !== "unknown" ? previewType : score.type;
        candidateBbox = refineBboxForDetectedType(el, candidateBbox, candidateType, vw, vh);
        previewText = sanitizePreviewTextByType(buildPreviewTextForBbox(el, candidateBbox, text), candidateType);
        if (!isLikelyCompleteQuestionText(previewText, candidateType)) { reject("completeness"); continue; }

        const candidate = attachDetectedQuestionIdentity({
          id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          bbox: candidateBbox,
          previewText: previewText.slice(0, 420),
          hasImage: score.hasImage,
          questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
          questionTypeGuess: candidateType,
          confidence: score.confidence,
          source: "auto_dom",
          identitySourceText: text,
          runtimeOwnerKey: getGroupId(el),
          boundary: boundaryFromRawRect(rawRect, vh),
        }, el, { identityText: text });

        const gid = getGroupId(el);
        const rank = completenessScore(candidate.previewText, candidateType, score.confidence);
        const prev = groupRank.get(gid) ?? -Infinity;
        if (rank > prev) {
          // DG-001: the displaced winner was also a probed candidate; count it
          // instead of dropping it silently.
          if (grouped.has(gid)) reject("grouped");
          groupRank.set(gid, rank);
          grouped.set(gid, candidate);
        } else {
          reject("grouped");
        }
      }
      if (grouped.size > 0) break;
    }
  }

  const blocks = [...grouped.values()];

  // Hard isolation for card-structured pages:
  // when an actual direct-card candidate was accepted, return those only.
  // This prevents cross-question merging/fragment filtering side-effects.
  if (hasAcceptedDirectCard && blocks.length > 0) {
    return finish(blocks.sort((a, b) => a.bbox.y - b.bbox.y).map(withQuestionCompleteness));
  }

  const merged = mergeAdjacentQuestionBlocks(deduplicateBlocks(blocks, diagnostics).sort((a, b) => a.bbox.y - b.bbox.y));
  return finish(filterFragmentBlocks(merged, diagnostics).map(withQuestionCompleteness));
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
if (!isHtmlElementNode(hostContainer)) continue;
    if (!hostContainer.matches(".question-item, .questionBox, .base-question-component")) continue;
    if (isExtensionUiElement(hostContainer)) continue;
    if (seen.has(hostContainer)) continue;
    seen.add(hostContainer);

    const rawRect = hostContainer.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 240 || rect.height < 120) continue;
    if (!hasEnoughVisibleStructuredCardArea(hostContainer, rawRect, vh)) continue;
    if (isTopClippedQuestionTail(hostContainer, rawRect, vh)) continue;

    const readableText = extractStructuredQuestionText(hostContainer);
    const displaySegments = extractStructuredQuestionDisplaySegments(hostContainer);
    const previewText = sanitizePreviewTextByType(readableText, inferQuestionType(readableText));
    const candidateType = inferQuestionType(previewText);
    if (!isLikelyCompleteQuestionText(previewText, candidateType)) continue;

    out.push(attachDetectedQuestionIdentity({
      id: `auto-structured-${Date.now()}-${index++}`,
      bbox: clampRectToBbox(rect, vw, vh),
      previewText: previewText.slice(0, 420),
      displaySegments,
      hasImage: hasMeaningfulVisualContent(hostContainer) || !!hostContainer.querySelector("table"),
      questionImageUrl: pickQuestionImageFromElement(hostContainer) ?? undefined,
      questionTypeGuess: candidateType,
      confidence: 0.94,
      source: "auto_dom",
      identitySourceText: readableText,
      runtimeOwnerKey: `structured-${index}`,
      boundary: boundaryFromRawRect(rawRect, vh),
    }, hostContainer, { identityText: readableText }));
  }

  return out;
}




function isTopClippedQuestionTail(container: HTMLElement, rect: DOMRect, vh: number): boolean {
  if (rect.top >= -24) return false;

  const titleNode = container.querySelector(".title-box,.questionTit,.question-title");
if (isHtmlElementNode(titleNode)) {
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
if (isHtmlElementNode(stemNode)) {
    const stemRect = stemNode.getBoundingClientRect();
    if (stemRect.height >= 8 && stemRect.width >= 20) {
      if (stemRect.bottom <= 24) return true;
      if (stemRect.top >= 20 && stemRect.top < vh - 16) return false;
    }
  }

  return rect.top < -48;
}

/** Provable slotted light-DOM containers: light children assigned to a slot of THIS shadow root. */
function collectSlottedLightContainers(shadowRoot: ShadowRoot): Element[] {
  const host = shadowRoot.host;
  if (!host) return [];
  const slots = Array.from(shadowRoot.querySelectorAll("slot"));
  if (!slots.length) return [];
  const out: Element[] = [];
  for (const child of Array.from(host.children)) {
if (!isHtmlElementNode(child)) continue;
    const slotName = child.getAttribute("slot") ?? "";
    const assigned = slots.some((slot) => (slot.getAttribute("name") ?? "") === slotName);
    if (!assigned) continue;
    out.push(child);
  }
  return out;
}

/**
 * Root-scoped detection pass: same structured-container pipeline as the top
 * document, bounded generic fallback, coordinates projected into top-tab
 * viewport space, and runtime root attachment on every candidate.
 */
export function detectCandidatesInRoot(root: TraversableRoot, context: RootContext, diagnostics?: DomCandidateDiagnostics): QuestionBlock[] {
  const vh = window.innerHeight;
  const registry = sharedRootRegistry();
  const projector = createTopViewportProjector(registry, context);
  const blocks: QuestionBlock[] = [];

  const containers = new Set<Element>(getStableQuestionCardContainers(root));
  if (isOpenShadowRootNode(root)) {
    for (const slotted of collectSlottedLightContainers(root)) {
      const rect = slotted.getBoundingClientRect();
      if (rect.width < 240 || rect.height < 120) continue;
      containers.add(slotted);
    }
  }

  let structuredIndex = 0;
  for (const hostContainer of containers) {
if (!isHtmlElementNode(hostContainer)) continue;
    const rawRect = hostContainer.getBoundingClientRect();
    const projected = projector({ left: rawRect.left, top: rawRect.top, width: rawRect.width, height: rawRect.height });
    if (!projected) continue;
    if (projected.width < 240 || projected.height < 120) continue;
    if (getVisibleVerticalRatio(rawRect, vh) < 0.55) continue;

    const readableText = extractStructuredQuestionText(hostContainer);
    if (!readableText || readableText.length < 10 || isLikelyControlPanelText(readableText)) continue;
    const previewText = sanitizePreviewTextByType(readableText, inferQuestionType(readableText));
    const candidateType = inferQuestionType(previewText);
    if (!isLikelyCompleteQuestionText(previewText, candidateType)) continue;

    const candidate = attachDetectedQuestionIdentity({
      id: nextRootCandidateObservationId(),
      bbox: { x: projected.left, y: projected.top, width: projected.width, height: projected.height },
      previewText: previewText.slice(0, 420),
      hasImage: hasMeaningfulVisualContent(hostContainer) || !!hostContainer.querySelector("table"),
      questionImageUrl: pickQuestionImageFromElement(hostContainer) ?? undefined,
      questionTypeGuess: candidateType,
      confidence: 0.94,
      source: "auto_dom",
      identitySourceText: readableText,
      runtimeOwnerKey: `root-${context.rootKey}-${structuredIndex++}`,
      boundary: boundaryFromRawRect({ top: rawRect.top, height: rawRect.height }, vh),
    }, hostContainer, { identityText: readableText, rootContext: context });
    blocks.push(candidate);
  }

  // Bounded generic fallback for roots without stable structured containers.
  if (blocks.length === 0) {
    const elements = Array.from(root.querySelectorAll("p,div,li,section,article")).slice(0, MAX_SHADOW_HOST_PROBES);
    let fallbackIndex = 0;
    for (const el of elements) {
      if (isExtensionUiElement(el)) continue;
      if ((el as HTMLElement).assignedSlot) continue;
      const text = normalizeText(el.textContent ?? "");
      if (!text || text.length < 12 || isLikelyControlPanelText(text)) continue;
      const score = scoreElement(el, text);
      if (score.confidence < 0.45) continue;
      const rawRect = (el as HTMLElement).getBoundingClientRect();
      const projected = projector({ left: rawRect.left, top: rawRect.top, width: rawRect.width, height: rawRect.height });
      if (!projected || projected.width < 80 || projected.height < 16) continue;
      const candidateType = score.type !== "unknown" ? score.type : inferQuestionType(text);
      const candidate = attachDetectedQuestionIdentity({
        id: nextRootCandidateObservationId(),
        bbox: { x: projected.left, y: projected.top, width: projected.width, height: projected.height },
        previewText: buildPreviewText(el, text).slice(0, 420),
        hasImage: score.hasImage,
        questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
        questionTypeGuess: candidateType,
        confidence: score.confidence * 0.9,
        source: "auto_dom",
        identitySourceText: text,
        runtimeOwnerKey: `root-fallback-${context.rootKey}-${fallbackIndex++}`,
        boundary: boundaryFromRawRect({ top: rawRect.top, height: rawRect.height }, vh),
      }, el, { identityText: text, rootContext: context });
      blocks.push(candidate);
    }
  }

  return filterFragmentBlocks(deduplicateBlocks(blocks, diagnostics).sort((a, b) => a.bbox.y - b.bbox.y), diagnostics).map(withQuestionCompleteness);
}

function getStableQuestionCardContainers(searchRoot: Document | ShadowRoot = document): Element[] {
  const preferredSelectors = [
    ".question-item",
    ".questionBox",
    ".base-question-component",
  ];
  const seen = new Set<Element>();
  const out: Element[] = [];

  for (const selector of preferredSelectors) {
    const nodes = Array.from(searchRoot.querySelectorAll(selector));
    for (const node of nodes) {
if (!isHtmlElementNode(node)) continue;
      if (seen.has(node) || isExtensionUiElement(node)) continue;
      // Light content slotted into a component's shadow tree belongs to that
      // composed component, never to the top document's candidate list.
      if (node.assignedSlot) continue;
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
  if (linkCount >= 6) {
    // A/B/C/D labels in a link directory are not sufficient question evidence.
    // Do not exempt nested menus merely because they live inside a question card.
    const marker = `${el.id} ${String((el as HTMLElement).className || "")}`.toLowerCase();
    if (/(?:nav|menu|toolbar|catalog|sidebar|breadcrumb)/.test(marker)) return true;
    const explicitQuestionHost = !!el.closest(".question-item,.questionBox,.base-question-component,.q-detail");
    // Linked answer choices are also valid on sites using custom card names.
    // Require BOTH a question-owned context and an actual stem signal.
    const ownsQuestionCard = /(?:question|problem|exam|quiz|test|exercise)[-_]?(?:card|item|block|body)/.test(marker);
    const credibleQuestionHost = ownsQuestionCard && isLikelyQuestionContext(el)
      && /[?？]|下列|哪项|正确的是|错误的是|第\s*\d{1,3}\s*题/.test(text);
    if (!explicitQuestionHost && !credibleQuestionHost) return true;
  }
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





/** Long structured questions must not be dropped solely because the full DOM
 * card is taller than the viewport. Still demand a substantial visible region,
 * full structured question text, and the existing clipped-top-tail exclusion.
 * A card barely entering the bottom of the screen is never authoritative. */
function hasEnoughVisibleStructuredCardArea(container: HTMLElement, rect: DOMRect, vh: number): boolean {
  if (getVisibleVerticalRatio(rect, vh) >= 0.55) return true;
  const visible = Math.max(0, Math.min(rect.bottom, vh) - Math.max(0, rect.top));
  if (rect.height <= vh || visible < Math.min(320, vh * 0.45)) return false;

  // A tall card's blank padding or placeholder can intersect the viewport
  // while its actual question is still below the fold. This extra check only
  // applies to the oversized-card fallback; ordinary cards remain unchanged.
  const stemAnchor = container.querySelector(
    ".title-box, .questionTit, .question-title, .qeustion-content, .questionContent, .question-content, .stem, p, h1, h2, h3",
  );
  if (isHtmlElementNode(stemAnchor)) {
    const stemRect = stemAnchor.getBoundingClientRect();
    if (stemRect.width >= 20 && stemRect.height >= 8) {
      return stemRect.bottom > 24 && stemRect.top < vh - 16;
    }
  }
  return true;
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
if (!isHtmlElementNode(n)) continue;
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


function applyRightCutToBbox(bbox: BoundingBox, cutX: number | null): BoundingBox {
  if (!Number.isFinite(cutX as number)) return bbox;
  const rightLimit = (cutX as number) - 10;
  const right = bbox.x + bbox.width;
  if (right <= rightLimit) return bbox;
  const width = Math.max(10, rightLimit - bbox.x);
  return { ...bbox, width };
}
