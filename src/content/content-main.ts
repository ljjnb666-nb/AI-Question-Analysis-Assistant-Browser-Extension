/**
 * Content Script Main (M1-M6 complete)
 * Adds: keyboard shortcut Alt+Q, streaming, scroll offset, retry, SPA watch
 */

import type { BoundingBox, ExtMessage, HistoryEntry, ParseResult, QuestionBlock, QuestionType } from "@/shared/types";
import { CaptureOverlay } from "./overlay/CaptureOverlay";
import { FloatingWindowManager } from "./floating/FloatingWindowManager";
import { HighlightLayer } from "./highlight/HighlightLayer";
import { FloatingTrigger } from "./overlay/FloatingTrigger";
import { detectCandidatesInViewport, watchForPageChanges } from "./detector/domDetector";
import {
  detectCandidatesFullPage,
  cancelFullPageScan,
  isFullPageScanRunning,
  resolveFullPageScrollRoot,
  type ScanScrollRoot,
  getScrollLeft,
  getScrollTop,
  setScrollPosition,
  pause as pauseFullPage,
} from "./detector/fullPageDetector";
import { fillParsedAnswerInPage, splitAnswerParts } from "./answerFiller";
import { pickBestAutoSolvePreviewText } from "./autoSolvePreview";
import {
  decodeFormulaLikeText,
  extractSemanticSvgLikeText,
  findNearbySemanticFormulaTextForImage,
  hasNearbyLargeVisualImageForSemanticNode,
  installFormulaEmbedFallback,
  normalizeMathDisplayText,
} from "./formulaEmbedFallback";
import { cropScreenshot } from "@/shared/utils/cropImage";
import { getProvider, parseQuestion } from "@/shared/utils/parseRouter";
import { loadSettings, addHistoryEntry, loadHistory, pruneIfNeeded } from "@/shared/utils/storage";
import { logEvent, initAnalytics } from "@/shared/utils/analytics";
import { sendToBackground } from "@/shared/utils/messaging";

// 鈹€鈹€鈹€ Init 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
initAnalytics();
pruneIfNeeded(); // clean up storage if near quota

// 鈹€鈹€鈹€ State 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
let activeOverlay: CaptureOverlay | null = null;
let highlightLayer: HighlightLayer | null = null;
let unwatchSPA: (() => void) | null = null;
const candidateStatusMap = new Map<string, { status: string; selected: boolean }>();
let activeCandidates: QuestionBlock[] = [];
let activeHighlightBlocks: QuestionBlock[] = [];
let activeDetectMode: "viewport" | "fullpage" | null = null;
let relayoutRescanTimer: number | null = null;
let lastFullPageLayoutKey = "";
let layoutResizeObserver: ResizeObserver | null = null;
let observedLayoutElements = new Set<Element>();
let autoSolveRunning = false;
let autoSolveStopRequested = false;

function isExtensionContextInvalidatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /Extension context invalidated/i.test(message);
}

function safeRuntimeSendMessage(message: unknown): void {
  try {
    const maybePromise = chrome.runtime.sendMessage(message);
    if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
      void (maybePromise as Promise<unknown>).catch((err) => {
        if (isExtensionContextInvalidatedError(err)) return;
        console.warn("[RuntimeMessage] send failed:", err);
      });
    }
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return;
    console.warn("[RuntimeMessage] send failed:", err);
  }
}

const floatingMgr = new FloatingWindowManager();
let pendingSubmit = false;
const STREAM_PARSE_TIMEOUT_MS = 20_000;
const MANUAL_PARSE_TIER_TIMEOUTS_MS = [10_000, 20_000, 30_000] as const;
const MANUAL_PARSE_PIPELINE_TIMEOUT_MS = 45_000;
const AUTO_SOLVE_PARSE_TIMEOUT_MS = 45_000;
const AUTO_SOLVE_REVIEW_TIMEOUT_MS = 60_000;
const AUTO_SOLVE_REVIEW_CONFIDENCE_THRESHOLD = 0.9;

floatingMgr.init();
floatingMgr.setOnRetake(() => startManualCapture(false));
floatingMgr.setOnUpgradeVision(() => {
  logEvent("vision_upgrade_triggered");
  startManualCapture(true);
});
installFormulaEmbedFallback();

// 鈹€鈹€鈹€ Floating trigger button 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Disabled by default - only create when user explicitly triggers capture
// if (!FloatingTrigger.getExisting()) {
//   new FloatingTrigger(() => startManualCapture(false));
// }

// 鈹€鈹€鈹€ Keyboard shortcut: Alt+Q = manual capture, Alt+W = auto detect 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (!e.altKey) return;
  if (e.key === "q" || e.key === "Q") {
    e.preventDefault();
    logEvent("keyboard_shortcut_used", { key: "Alt+Q" });
    startManualCapture(false);
  }
  if (e.key === "w" || e.key === "W") {
    e.preventDefault();
    logEvent("keyboard_shortcut_used", { key: "Alt+W" });
    handleAutoDetect();
  }
});

window.addEventListener("resize", () => {
  scheduleHighlightRelayoutRescan();
}, { passive: true });

document.addEventListener("scroll", () => {
  scheduleHighlightRelayoutRescan();
}, { passive: true, capture: true });

window.visualViewport?.addEventListener("resize", () => {
  scheduleHighlightRelayoutRescan();
}, { passive: true });

window.visualViewport?.addEventListener("scroll", () => {
  scheduleHighlightRelayoutRescan();
}, { passive: true });

ensureLayoutResizeObserver();
refreshLayoutResizeObservation();

// 鈹€鈹€鈹€ Messages 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
chrome.runtime.onMessage.addListener((message: ExtMessage, _sender, sendResponse) => {
  switch (message.type) {
    case "START_MANUAL_CAPTURE":
      startManualCapture(false);
      sendResponse({ ok: true });
      return false;

    case "CANCEL_MANUAL_CAPTURE":
      activeOverlay?.destroy();
      activeOverlay = null;
      sendResponse({ ok: true });
      return false;

    case "CLOSE_FLOATING_RESULT":
      floatingMgr.close();
      sendResponse({ ok: true });
      return false;

    case "START_AUTO_DETECT":
      handleAutoDetect();
      sendResponse({ ok: true });
      return false;

    case "HIGHLIGHT_CANDIDATE":
      if ("blockId" in message) highlightLayer?.flashBlock(message.blockId as string);
      sendResponse({ ok: true });
      return false;

    case "UPDATE_CANDIDATE_SELECTION":
      applySelectionUpdate(message);
      sendResponse({ ok: true });
      return false;

    case "CLEAR_HIGHLIGHTS":
      highlightLayer?.destroy();
      highlightLayer = null;
      unwatchSPA?.();
      unwatchSPA = null;
      candidateStatusMap.clear();
      activeCandidates = [];
      activeHighlightBlocks = [];
      activeDetectMode = null;
      lastFullPageLayoutKey = "";
      refreshLayoutResizeObservation();
      sendResponse({ ok: true });
      return false;

    case "START_FULL_PAGE_DETECT":
      handleFullPageDetect();
      sendResponse({ ok: true });
      return false;

    case "FULL_PAGE_DETECT_CANCELLED":
      cancelFullPageScan();
      sendResponse({ ok: true });
      return false;

    case "CAPTURE_BLOCK_IMAGE":
      if (!("bbox" in message) || !message.bbox) {
        sendResponse({ ok: false, error: "Missing bbox" });
        return false;
      }
      void (async () => {
        try {
          const dataUrl = await captureBlockImage(message.bbox as BoundingBox);
          sendResponse({ ok: !!dataUrl, dataUrl: dataUrl ?? undefined });
        } catch (err) {
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return true;

    case "FILL_PARSED_ANSWER":
      if (!("block" in message) || !("result" in message) || !message.block || !message.result) {
        sendResponse({ ok: false, error: "Missing fill payload" });
        return false;
      }
      void (async () => {
        try {
          const fillResult = fillParsedAnswerInPage(message.block, message.result);
          sendResponse(fillResult);
        } catch (err) {
          sendResponse({ ok: false, filledCount: 0, message: err instanceof Error ? err.message : String(err) });
        }
      })();
      return true;

    case "START_AUTO_SOLVE_ALL":
      void handleAutoSolveAll();
      sendResponse({ ok: true });
      return false;

    case "STOP_AUTO_SOLVE_ALL":
      autoSolveStopRequested = true;
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

// 鈹€鈹€鈹€ Manual Capture 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function applySelectionUpdate(
  message: Extract<ExtMessage, { type: "UPDATE_CANDIDATE_SELECTION" }>
) {
  if (typeof message.selectAll === "boolean") {
    for (const state of candidateStatusMap.values()) {
      state.selected = message.selectAll;
    }
  } else if (message.blockId && typeof message.selected === "boolean") {
    const state = candidateStatusMap.get(message.blockId);
    if (state) {
      state.selected = message.selected;
    }
  }

  if (highlightLayer && activeHighlightBlocks.length > 0) {
    highlightLayer.setBlocks(activeHighlightBlocks, candidateStatusMap);
  }
  if (activeCandidates.length > 0) {
    notifySidePanel(activeCandidates);
  }
}

function scheduleHighlightRelayoutRescan() {
  if (!highlightLayer || activeCandidates.length === 0) return;
  if (relayoutRescanTimer !== null) {
    window.clearTimeout(relayoutRescanTimer);
  }
  relayoutRescanTimer = window.setTimeout(() => {
    relayoutRescanTimer = null;
    if (activeDetectMode === "viewport") {
      refreshViewportCandidatesAfterLayoutChange();
      return;
    }
    if (activeDetectMode === "fullpage") {
      const scrollRoot = resolveFullPageScrollRoot();
      const layoutKey = getFullPageLayoutKey(scrollRoot);
      if (layoutKey !== lastFullPageLayoutKey) {
        lastFullPageLayoutKey = layoutKey;
        refreshFullPageHighlightsAfterLayoutChange();
      }
    }
  }, 180);
}

function ensureLayoutResizeObserver() {
  if (layoutResizeObserver || typeof ResizeObserver === "undefined") return;
  layoutResizeObserver = new ResizeObserver(() => {
    if (activeDetectMode !== "fullpage") return;
    scheduleHighlightRelayoutRescan();
  });
}

function refreshLayoutResizeObservation() {
  if (!layoutResizeObserver) return;

  const nextObserved = new Set<Element>();
  nextObserved.add(document.documentElement);
  if (document.body) nextObserved.add(document.body);

  if (activeDetectMode === "fullpage") {
    const scrollRoot = resolveFullPageScrollRoot();
    if (scrollRoot instanceof HTMLElement) {
      nextObserved.add(scrollRoot);
      if (scrollRoot.parentElement) nextObserved.add(scrollRoot.parentElement);
    }
  }

  for (const el of observedLayoutElements) {
    if (!nextObserved.has(el)) {
      layoutResizeObserver.unobserve(el);
    }
  }

  for (const el of nextObserved) {
    if (!observedLayoutElements.has(el)) {
      layoutResizeObserver.observe(el);
    }
  }

  observedLayoutElements = nextObserved;
}

function refreshViewportCandidatesAfterLayoutChange() {
  if (activeDetectMode !== "viewport") return;
  if (!highlightLayer) return;

  const nextCandidates = detectCandidatesInViewport();
  if (nextCandidates.length === 0) return;

  const previousCandidates = activeCandidates;
  const nextStatusMap = new Map<string, { status: string; selected: boolean }>();

  for (const next of nextCandidates) {
    const matched = findMatchingCandidate(previousCandidates, next);
    if (matched) {
      nextStatusMap.set(next.id, candidateStatusMap.get(matched.id) ?? { status: "pending", selected: false });
    } else {
      nextStatusMap.set(next.id, { status: "pending", selected: false });
    }
  }

  candidateStatusMap.clear();
  for (const [id, state] of nextStatusMap) {
    candidateStatusMap.set(id, state);
  }

  activeCandidates = nextCandidates;
  activeHighlightBlocks = nextCandidates;
  highlightLayer.setBlocks(activeHighlightBlocks, candidateStatusMap);
  notifySidePanel(activeCandidates);
}

function refreshFullPageHighlightsAfterLayoutChange() {
  if (activeDetectMode !== "fullpage") return;
  if (!highlightLayer) return;
  const scrollRoot = resolveFullPageScrollRoot();
  lastFullPageLayoutKey = getFullPageLayoutKey(scrollRoot);
  refreshLayoutResizeObservation();
  const remappedBlocks = remapFullPageBlocksFromDom(activeCandidates, scrollRoot);
  if (remappedBlocks.length === activeCandidates.length) {
    activeCandidates = remappedBlocks;
    activeHighlightBlocks = remappedBlocks;
  }
  highlightLayer.setBlocks(activeHighlightBlocks, candidateStatusMap);
}

function getFullPageLayoutKey(scrollRoot: ScanScrollRoot): string {
  if (!(scrollRoot instanceof HTMLElement)) {
    return `window:${window.innerWidth}x${window.innerHeight}`;
  }

  const rect = scrollRoot.getBoundingClientRect();
  return [
    "root",
    Math.round(window.innerWidth),
    Math.round(window.innerHeight),
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ].join(":");
}

function remapFullPageBlocksFromDom(blocks: QuestionBlock[], scrollRoot: ScanScrollRoot): QuestionBlock[] {
  const containerNodes = Array.from(
    document.querySelectorAll<HTMLElement>(".question-item, .questionBox, .base-question-component"),
  ).filter((el) => {
    if (!el.isConnected || isExtensionUiElement(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 240 && rect.height >= 120;
  });

  const seenContainers = new Set<HTMLElement>();
  const containerRecords = containerNodes
    .filter((el) => {
      if (seenContainers.has(el)) return false;
      seenContainers.add(el);
      return true;
    })
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const viewportBox: BoundingBox = {
        x: Math.max(0, rect.left),
        y: Math.max(0, rect.top),
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
      const previewText = normalizeQuestionText(el.innerText || el.textContent || "");
      return {
        el,
        previewText,
        order: extractAutoSolveQuestionOrder(previewText),
        fingerprint: getAutoSolveTextFingerprint(previewText),
        type: inferAutoSolveQuestionType(previewText),
        bbox: projectViewportBboxToAbsolute(viewportBox, scrollRoot),
      };
    });

  const used = new Set<number>();
  const remapped: QuestionBlock[] = [];

  for (const block of [...blocks].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)) {
    const blockOrder = extractAutoSolveQuestionOrder(block.previewText || "");
    const blockFingerprint = getAutoSolveTextFingerprint(block.previewText || "");
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < containerRecords.length; i += 1) {
      if (used.has(i)) continue;
      const record = containerRecords[i];
      let score = 0;
      if (blockOrder !== null && record.order !== null && blockOrder === record.order) score += 120;
      if (blockFingerprint && record.fingerprint) {
        if (blockFingerprint === record.fingerprint) score += 120;
        else if (
          blockFingerprint.length >= 16 &&
          record.fingerprint.length >= 16 &&
          (blockFingerprint.includes(record.fingerprint) || record.fingerprint.includes(blockFingerprint))
        ) {
          score += 80;
        }
      }
      if (record.type === block.questionTypeGuess) score += 20;
      score -= Math.abs(record.bbox.y - block.bbox.y) / 12;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestScore >= 80) {
      used.add(bestIndex);
      remapped.push({
        ...block,
        bbox: containerRecords[bestIndex].bbox,
      });
      continue;
    }

    remapped.push(block);
  }

  return remapped;
}

function startManualCapture(forceVisionMode: boolean) {
  if (activeOverlay) { activeOverlay.destroy(); activeOverlay = null; }
  highlightLayer?.destroy();
  highlightLayer = null;
  activeDetectMode = null;
  lastFullPageLayoutKey = "";
  refreshLayoutResizeObservation();
  logEvent("manual_capture_started");

  activeOverlay = new CaptureOverlay({
    onSubmit: (bbox, forceVision) => handleBBoxSubmit(bbox, forceVisionMode || forceVision),
    onCancel: () => {
      activeOverlay = null;
      logEvent("manual_capture_cancelled");
    },
  });
}

async function handleBBoxSubmit(bbox: BoundingBox, forceVision: boolean) {
  activeOverlay = null;
  if (pendingSubmit) return;
  pendingSubmit = true;

  const resolved = resolveQuestionBlockFromBBox(bbox);
  const refinedBBox = resolved.refinedBBox;

  logEvent("manual_capture_submitted", {
    bboxW: refinedBBox.width, bboxH: refinedBBox.height,
    forceVision,
    scrollY: window.scrollY,
  });
  const finalBBox = resolved.finalBBox;
  const previewText = resolved.previewText;
  const matchedCandidate = resolved.matchedCandidate;

  const block: QuestionBlock = {
    id: `manual-${Date.now()}`,
    bbox: finalBBox,
    previewText,
    displaySegments: matchedCandidate?.displaySegments,
    questionImageUrl:
      matchedCandidate?.questionImageUrl ??
      extractQuestionImageUrlFromBBox(finalBBox) ??
      undefined,
    hasImage: forceVision || Boolean(matchedCandidate?.hasImage),
    questionTypeGuess: matchedCandidate?.questionTypeGuess ?? "unknown",
    confidence: Math.max(0.8, matchedCandidate?.confidence ?? 0),
    source: "manual_capture",
  };
  if (block.questionImageUrl) block.hasImage = true;

  floatingMgr.open(block);

  try {

    // Screenshot with retry
    const dataUrl = await screenshotWithRetry();
    if (dataUrl) {
      logEvent("manual_capture_completed");
      // Crop (account for scroll offset via devicePixelRatio)
      const croppedDataUrl = await cropScreenshot(dataUrl, finalBBox, window.devicePixelRatio);
      block.imageDataUrl = croppedDataUrl;
    } else {
      logEvent("manual_capture_completed", { screenshotFallback: true });
    }

    // Parse with optional streaming
    const settings = await loadSettings();
    const provider = getProvider(settings.providerId ?? "anthropic");
    const hasCapturedImage = Boolean(block.imageDataUrl);
    const forceNonTextRoute =
      provider.supportsVision &&
      hasCapturedImage &&
      settings.preferredRoute === "text";
    // Manual capture has a precise cropped image; prefer vision route whenever available.
    const effectiveSettings = forceVision
      ? { ...settings, preferredRoute: "vision" as const }
      : provider.supportsVision && hasCapturedImage
        ? { ...settings, preferredRoute: "vision" as const }
        : forceNonTextRoute
          ? { ...settings, preferredRoute: "auto" as const }
          : settings;

    const finalResult = await withTimeout(
      (async () => {
        const firstPassResult = await parseWithTieredRetries(
          block,
          effectiveSettings,
          provider.supportsVision,
          floatingMgr.setStreamingText.bind(floatingMgr),
        );

        let pickedResult = firstPassResult;
        const shouldRetryWithVision =
          !forceVision &&
          provider.supportsVision &&
          Boolean(block.imageDataUrl) &&
          isLikelyIncompleteStem(firstPassResult);

        if (shouldRetryWithVision) {
          logEvent("manual_auto_vision_retry_started", {
            blockId: block.id,
            initialConfidence: firstPassResult.confidence,
          });
          floatingMgr.setStreamingText("检测到题干可能不完整，正在进行视觉复核...");

          const visionBlock: QuestionBlock = { ...block, hasImage: true };
          const visionSettings = { ...settings, preferredRoute: "vision" as const };
          const visionResult = await parseWithTieredRetries(
            visionBlock,
            visionSettings,
            true,
            floatingMgr.setStreamingText.bind(floatingMgr),
          );

          if (shouldPreferVisionResult(firstPassResult, visionResult)) {
            pickedResult = visionResult;
            logEvent("manual_auto_vision_retry_applied", {
              blockId: block.id,
              beforeConfidence: firstPassResult.confidence,
              afterConfidence: visionResult.confidence,
            });
          } else {
            logEvent("manual_auto_vision_retry_skipped", {
              blockId: block.id,
              beforeConfidence: firstPassResult.confidence,
              afterConfidence: visionResult.confidence,
            });
          }
        }

        const shouldRunSecondVisionReview =
          provider.supportsVision &&
          Boolean(block.imageDataUrl) &&
          shouldForceSecondVisionReview(block, pickedResult);

        if (shouldRunSecondVisionReview) {
          logEvent("manual_second_vision_review_started", {
            blockId: block.id,
            confidence: pickedResult.confidence,
          });
          floatingMgr.setStreamingText("正在进行二次视觉复核，优化分点答案...");
          const secondVisionBlock: QuestionBlock = { ...block, hasImage: true };
          const secondVisionResult = await parseWithTieredRetries(
            secondVisionBlock,
            { ...settings, preferredRoute: "vision" as const },
            true,
            floatingMgr.setStreamingText.bind(floatingMgr),
          );
          if (shouldPreferSecondVisionResult(pickedResult, secondVisionResult, block)) {
            pickedResult = secondVisionResult;
            logEvent("manual_second_vision_review_applied", {
              blockId: block.id,
              beforeConfidence: firstPassResult.confidence,
              afterConfidence: secondVisionResult.confidence,
            });
          } else {
            logEvent("manual_second_vision_review_skipped", {
              blockId: block.id,
              beforeConfidence: firstPassResult.confidence,
              afterConfidence: secondVisionResult.confidence,
            });
          }
        }
        return pickedResult;
      })(),
      MANUAL_PARSE_PIPELINE_TIMEOUT_MS,
      "manual_pipeline_timeout",
    );

    floatingMgr.setResult(finalResult);

    await addHistoryEntry({ id: block.id, timestamp: Date.now(), block, result: finalResult, host: location.hostname });
    if (finalResult.confidence < 0.5) logEvent("parse_low_confidence", { blockId: block.id });

  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err);
    const settings = await loadSettings();
    const provider = getProvider(settings.providerId ?? "anthropic");
    if (/manual_pipeline_timeout/i.test(msg)) {
      msg = "解析超时：已尝试多次请求但未收到可用结果。请重试，或切换其他模型/路由。";
    } else if (/failed to fetch/i.test(msg)) {
      const baseUrlRaw = settings.customBaseUrl || provider.baseUrl;
      let host = String(baseUrlRaw || "");
      try {
        host = new URL(host).host || host;
      } catch {
        // keep raw host
      }
      msg = `网络请求失败（${provider.name} / ${host}）。请检查 API 地址、Key、代理或网络。`;
    }
    const canRetryWithVision =
      provider.supportsVision &&
      Boolean(block.imageDataUrl) &&
      !forceVision;

    if (canRetryWithVision && /text[- ]?only|鏂囨湰妯″瀷|鏂囨湰璺嚎|image question/i.test(msg)) {
      try {
        floatingMgr.setStreamingText("检测到当前配置与图片题不匹配，正在自动切换视觉解析...");
        const visionResult = await parseWithTieredRetries(
          { ...block, hasImage: true },
          { ...settings, preferredRoute: "vision" as const },
          true,
          floatingMgr.setStreamingText.bind(floatingMgr),
        );
        floatingMgr.setResult(visionResult);
        await addHistoryEntry({ id: block.id, timestamp: Date.now(), block, result: visionResult, host: location.hostname });
        pendingSubmit = false;
        return;
      } catch (visionErr) {
        const visionMsg = visionErr instanceof Error ? visionErr.message : String(visionErr);
        floatingMgr.setError(visionMsg);
        logEvent("parse_error", { error: visionMsg, autoVisionRetry: true });
        pendingSubmit = false;
        return;
      }
    }

    floatingMgr.setError(msg);
    logEvent("parse_error", { error: msg });
  } finally {
    pendingSubmit = false;
  }
}

async function parseWithStreamingFallback(
  block: QuestionBlock,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  onStream: (partial: string) => void,
  timeoutMs = STREAM_PARSE_TIMEOUT_MS,
) {
  try {
    const streamed = await withTimeout(
      parseQuestion(block, settings, onStream),
      timeoutMs,
      "stream_timeout",
    );
    return streamed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/stream_timeout/i.test(msg)) throw err;
    logEvent("parse_stream_timeout_fallback", { blockId: block.id, timeoutMs });
    floatingMgr.setStreamingText("流式响应超时，正在切换为普通请求重试...");
    // Important: guard non-stream fallback with timeout as well to avoid hanging forever.
    return withTimeout(
      parseQuestion(block, settings),
      Math.max(8_000, Math.floor(timeoutMs * 0.9)),
      "non_stream_timeout",
    );
  }
}

async function parseWithTieredRetries(
  block: QuestionBlock,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  providerSupportsVision: boolean,
  onStream: (partial: string) => void,
) {
  const preferred = settings.preferredRoute;
  const routePlan: Array<"text" | "auto" | "vision"> = [];
  if (preferred === "text") {
    routePlan.push("text", providerSupportsVision ? "vision" : "auto", "auto");
  } else if (preferred === "vision") {
    routePlan.push("vision", "auto", "vision");
  } else {
    routePlan.push("auto", providerSupportsVision ? "vision" : "text", "auto");
  }

  let lastErr: unknown = null;
  for (let i = 0; i < MANUAL_PARSE_TIER_TIMEOUTS_MS.length; i++) {
    const timeoutMs = MANUAL_PARSE_TIER_TIMEOUTS_MS[i];
    const route = routePlan[i] ?? preferred;
    const tierSettings = { ...settings, preferredRoute: route as "auto" | "text" | "vision" };

    logEvent("manual_parse_attempt_started", {
      blockId: block.id,
      attempt: i + 1,
      timeoutMs,
      route,
      hasImageDataUrl: Boolean(block.imageDataUrl),
      previewTextLen: (block.previewText || "").length,
    });
    console.info("[ManualParse] attempt start", {
      blockId: block.id,
      attempt: i + 1,
      timeoutMs,
      route,
      hasImageDataUrl: Boolean(block.imageDataUrl),
    });
    try {
      floatingMgr.setStreamingText(`第 ${i + 1} 次尝试：${route} 路由，超时 ${Math.round(timeoutMs / 1000)}s...`);
      const startedAt = Date.now();
      const result = await parseWithStreamingFallback(block, tierSettings, onStream, timeoutMs);
      const elapsedMs = Date.now() - startedAt;
      logEvent("manual_parse_attempt_succeeded", {
        blockId: block.id,
        attempt: i + 1,
        timeoutMs,
        route,
        elapsedMs,
        confidence: result.confidence,
        answer: result.answer,
        routeUsed: result.routeUsed,
      });
      console.info("[ManualParse] attempt success", {
        blockId: block.id,
        attempt: i + 1,
        timeoutMs,
        route,
        elapsedMs,
        answer: result.answer,
        confidence: result.confidence,
        routeUsed: result.routeUsed,
      });
      return result;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      logEvent("manual_parse_attempt_failed", {
        blockId: block.id,
        attempt: i + 1,
        timeoutMs,
        route,
        error: msg.slice(0, 500),
      });
      console.warn("[ManualParse] attempt failed", {
        blockId: block.id,
        attempt: i + 1,
        timeoutMs,
        route,
        error: msg,
      });
      if (i < MANUAL_PARSE_TIER_TIMEOUTS_MS.length - 1) {
        floatingMgr.setStreamingText(`第 ${i + 1} 次失败：${msg.slice(0, 80)}\n正在第 ${i + 2} 次重试（${routePlan[i + 1]} / ${MANUAL_PARSE_TIER_TIMEOUTS_MS[i + 1] / 1000}s）...`);
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "parse_failed"));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: number | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(new Error(reason)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

function isLikelyIncompleteStem(result: Awaited<ReturnType<typeof parseQuestion>>): boolean {
  if (result.confidence < 0.45) return true;
  const warningText = `${result.warning ?? ""} ${result.briefExplanation ?? ""}`.toLowerCase();
  return /(缺失题干|题目不完整|选项缺失|无法作答|无法判断|无法确定|missing stem|incomplete question|missing options|insufficient options)/i.test(warningText);
}

function shouldPreferVisionResult(
  textResult: Awaited<ReturnType<typeof parseQuestion>>,
  visionResult: Awaited<ReturnType<typeof parseQuestion>>,
): boolean {
  const confidenceJump = visionResult.confidence - textResult.confidence;
  const textHasStemWarning = isLikelyIncompleteStem(textResult);
  const visionHasStemWarning = isLikelyIncompleteStem(visionResult);
  if (confidenceJump >= 0.15) return true;
  if (textHasStemWarning && !visionHasStemWarning && visionResult.confidence >= 0.5) return true;
  if (textResult.answer === "?" && visionResult.answer !== "?") return true;
  return false;
}

function shouldForceSecondVisionReview(
  block: QuestionBlock,
  result: Awaited<ReturnType<typeof parseQuestion>>,
): boolean {
  const stem = `${block.previewText || ""}\n${result.recognizedText || ""}`;
  const nonChoiceStem = looksNonChoiceStem(stem);
  if (!nonChoiceStem) return false;
  if (result.confidence < 0.8) return true;
  if (looksLowQualityNonChoiceAnswer(result)) return true;
  return false;
}

function shouldPreferSecondVisionResult(
  prev: Awaited<ReturnType<typeof parseQuestion>>,
  next: Awaited<ReturnType<typeof parseQuestion>>,
  block: QuestionBlock,
): boolean {
  const prevBad = looksLowQualityNonChoiceAnswer(prev);
  const nextBad = looksLowQualityNonChoiceAnswer(next);
  if (prevBad && !nextBad) return true;
  if (!nextBad && next.confidence - prev.confidence >= 0.05) return true;
  if (looksNonChoiceStem(`${block.previewText || ""}\n${next.recognizedText || ""}`) && hasStructuredPoints(next.answer || next.detailedExplanation || "")) {
    if (!hasStructuredPoints(prev.answer || prev.detailedExplanation || "")) return true;
  }
  return false;
}

function looksLowQualityNonChoiceAnswer(result: Awaited<ReturnType<typeof parseQuestion>>): boolean {
  const answer = String(result.answer || "").trim();
  const brief = String(result.briefExplanation || "");
  const warning = String(result.warning || "");
  const longNarrative = answer.length > 90 && !hasStructuredPoints(answer);
  const uncertain = /(无法|不确定|看不清|不完整|信息不足|missing|incomplete|insufficient)/i.test(`${brief}\n${warning}\n${answer}`);
  const optionSet = /^[A-D](?:\s*[,，、/|]\s*[A-D])+$/.test(answer);
  if (optionSet) return true;
  if (longNarrative && uncertain) return true;
  return false;
}

function looksNonChoiceStem(text: string): boolean {
  return /\(\s*1\s*\)|（\s*1\s*）|请据图回答|填空|____|________|简答|分析/.test(String(text || ""));
}

function hasStructuredPoints(text: string): boolean {
  const t = String(text || "");
  return /\(\s*\d+\s*\)|（\s*\d+\s*）|[①②③④⑤⑥⑦⑧⑨⑩]/.test(t);
}

async function handleAutoSolveAll() {
  if (autoSolveRunning) return;

  autoSolveRunning = true;
  autoSolveStopRequested = false;

  let solved = 0;
  let filled = 0;
  let total = detectTotalQuestionCount();
  const fixedTotal = total > 0 ? total : 0;
  let lastFingerprint = "";
  let repeatedCount = 0;
  const history = await loadHistory();

  try {
    sendAutoSolveProgress({
      running: true,
      solved,
      filled,
      total,
      current: solved + 1,
      statusText: "开始自动答题...",
    });

    for (let round = 0; round < Math.max(fixedTotal || total || 0, 1) + 8; round += 1) {
      if (autoSolveStopRequested) {
        sendAutoSolveDone({
          ok: true,
          stopped: true,
          solved,
          filled,
          total: Math.max(total, solved),
          message: "已停止自动答题",
        });
        return;
      }

      await pauseMs(500);
      const currentBlock = pickLiveAutoSolveBlock();
      if (!currentBlock) {
        sendAutoSolveDone({
          ok: false,
          solved,
          filled,
          total: Math.max(total, solved),
          message: "未找到当前题目题块，自动答题已停止",
        });
        return;
      }

      if (total <= 0) {
        total = Math.max(detectTotalQuestionCount(), solved + 1);
      }
      const currentFingerprint = getAutoSolveFingerprint(currentBlock);
      const currentOrder = extractAutoSolveQuestionOrder(currentBlock.previewText || "");
      if (currentFingerprint && currentFingerprint === lastFingerprint) {
        repeatedCount += 1;
      } else {
        repeatedCount = 0;
        lastFingerprint = currentFingerprint;
      }

      if (repeatedCount >= 2) {
        sendAutoSolveDone({
          ok: true,
          solved,
          filled,
          total: Math.max(total, solved),
          message: "检测到题目未继续变化，自动答题已停止",
        });
        return;
      }

      sendAutoSolveProgress({
        running: true,
        solved,
        filled,
        total,
        current: solved + 1,
        statusText: `正在解析第 ${solved + 1} 题...`,
        currentQuestionId: currentBlock.id,
        currentPreview: currentBlock.previewText.slice(0, 140),
      });

      const answerState = inspectAutoSolveAnswerState(currentBlock);
      const historyEntry = findReusableHistoryEntry(history, currentBlock);
      const needsHistoryReview = shouldReviewLowConfidenceHistory(historyEntry);

      if (answerState.complete && !needsHistoryReview) {
        solved += 1;
        sendAutoSolveProgress({
          running: true,
          solved,
          filled,
          total,
          current: solved,
          statusText: answerState.mode === "text"
            ? `检测到本题已填写 ${answerState.answeredCount}/${answerState.totalCount} 个答案，已跳过`
            : "检测到本题已作答，已跳过",
          currentQuestionId: currentBlock.id,
          currentPreview: currentBlock.previewText.slice(0, 140),
        });

        const nextClicked = clickNextQuestionButton();
        if (!nextClicked) {
          sendAutoSolveDone({
            ok: true,
            solved,
            filled,
            total: Math.max(total, solved),
            message: `自动答题完成，共处理 ${solved} 题`,
          });
          return;
        }

        const advanced = await waitForQuestionAdvance(lastFingerprint, currentOrder);
        if (!advanced && shouldStopAutoSolveAtTail(currentOrder, fixedTotal || total)) {
          sendAutoSolveDone({
            ok: true,
            solved,
            filled,
            total: Math.max(fixedTotal || total, solved),
            message: `自动答题完成，共处理 ${solved} 题`,
          });
          return;
        }
        continue;
      }

      if (answerState.complete && needsHistoryReview) {
        sendAutoSolveProgress({
          running: true,
          solved,
          filled,
          total,
          current: solved + 1,
          statusText: `检测到本题已填写，但历史置信度仅 ${Math.round((historyEntry?.result.confidence ?? 0) * 100)}%，正在复核...`,
          currentQuestionId: currentBlock.id,
          currentPreview: currentBlock.previewText.slice(0, 140),
        });
      }

      if (historyEntry && !needsHistoryReview) {
        sendAutoSolveProgress({
          running: true,
          solved,
          filled,
          total,
          current: solved + 1,
          statusText: `复用历史解析结果并填写第 ${solved + 1} 题...`,
          currentQuestionId: currentBlock.id,
          currentPreview: currentBlock.previewText.slice(0, 140),
        });

        const fillResult = fillParsedAnswerInPage(currentBlock, historyEntry.result);
        filled += fillResult.filledCount;
        solved += 1;

        sendAutoSolveProgress({
          running: true,
          solved,
          filled,
          total,
          current: solved,
          statusText: fillResult.ok ? `已复用历史答案：${fillResult.message}` : `历史答案未写入：${fillResult.message}`,
          currentQuestionId: currentBlock.id,
          currentPreview: currentBlock.previewText.slice(0, 140),
        });

        const nextClicked = clickNextQuestionButton();
        if (!nextClicked) {
          sendAutoSolveDone({
            ok: true,
            solved,
            filled,
            total: Math.max(total, solved),
            message: `自动答题完成，共处理 ${solved} 题`,
          });
          return;
        }

        const advanced = await waitForQuestionAdvance(lastFingerprint, currentOrder);
        if (!advanced && shouldStopAutoSolveAtTail(currentOrder, fixedTotal || total)) {
          sendAutoSolveDone({
            ok: true,
            solved,
            filled,
            total: Math.max(fixedTotal || total, solved),
            message: `自动答题完成，共处理 ${solved} 题`,
          });
          return;
        }
        continue;
      }

      let progressMessage = "";
      try {
        const parsed = needsHistoryReview
          ? await parseBlockForAutoSolveReview(currentBlock, historyEntry?.result ?? null)
          : await parseBlockForAutoSolve(currentBlock);

        sendAutoSolveProgress({
          running: true,
          solved,
          filled,
          total,
          current: solved + 1,
          statusText: needsHistoryReview
            ? `复核完成，正在更新第 ${solved + 1} 题答案：${parsed.answer || "-"}`
            : `正在填写第 ${solved + 1} 题，答案：${parsed.answer || "-"}`,
          currentQuestionId: currentBlock.id,
          currentPreview: currentBlock.previewText.slice(0, 140),
        });

        const fillResult = fillParsedAnswerInPage(currentBlock, parsed);
        filled += fillResult.filledCount;

        await addHistoryEntry({
          id: `auto-solve-${Date.now()}-${solved + 1}`,
          timestamp: Date.now(),
          block: { ...currentBlock, imageDataUrl: undefined },
          result: parsed,
          host: location.hostname,
        });
        history.unshift({
          id: `auto-solve-${Date.now()}-${solved + 1}`,
          timestamp: Date.now(),
          block: { ...currentBlock, imageDataUrl: undefined },
          result: parsed,
          host: location.hostname,
        });

        progressMessage = fillResult.ok ? fillResult.message : `填写失败：${fillResult.message}`;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        progressMessage = answerState.complete
          ? `复核失败，保留现有答案：${errMsg}`
          : `解析失败，已跳过：${errMsg}`;
      }

      solved += 1;

      sendAutoSolveProgress({
        running: true,
        solved,
        filled,
        total,
        current: solved,
        statusText: progressMessage,
        currentQuestionId: currentBlock.id,
        currentPreview: currentBlock.previewText.slice(0, 140),
      });

      const nextClicked = clickNextQuestionButton();
      if (!nextClicked) {
        sendAutoSolveDone({
          ok: true,
          solved,
          filled,
          total: Math.max(total, solved),
          message: `自动答题完成，共处理 ${solved} 题`,
        });
        return;
      }

      const advanced = await waitForQuestionAdvance(lastFingerprint, currentOrder);
      if (!advanced && shouldStopAutoSolveAtTail(currentOrder, fixedTotal || total)) {
        sendAutoSolveDone({
          ok: true,
          solved,
          filled,
          total: Math.max(fixedTotal || total, solved),
          message: `自动答题完成，共处理 ${solved} 题`,
        });
        return;
      }
    }

    sendAutoSolveDone({
      ok: true,
      solved,
      filled,
      total: Math.max(total, solved),
      message: `自动答题完成，共处理 ${solved} 题`,
    });
  } catch (err) {
    sendAutoSolveDone({
      ok: false,
      solved,
      filled,
      total: Math.max(total, solved),
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    autoSolveRunning = false;
    autoSolveStopRequested = false;
  }
}

async function parseBlockForAutoSolve(block: QuestionBlock) {
  const settings = await loadSettings();
  const provider = getProvider(settings.providerId ?? "anthropic");
  const wantsVision = provider.supportsVision && shouldUseVisionForAutoSolve(block, settings.preferredRoute);

  let parseBlock: QuestionBlock = block;
  if (provider.supportsVision) {
    const imageDataUrl = await tryCaptureBlockImageForAutoSolve(block.bbox);
    if (imageDataUrl) {
      parseBlock = { ...block, hasImage: true, imageDataUrl };
    }
  }

  const firstPassSettings = wantsVision
    ? { ...settings, preferredRoute: "vision" as const }
    : settings;

  let result = await withTimeout(
    parseWithTieredRetries(parseBlock, firstPassSettings, provider.supportsVision, () => {}),
    AUTO_SOLVE_PARSE_TIMEOUT_MS,
    "auto_solve_parse_timeout",
  );
  if (provider.supportsVision && shouldRetryWithVisionForAuto(result, block)) {
    const imageDataUrl = parseBlock.imageDataUrl || await tryCaptureBlockImageForAutoSolve(block.bbox);
    if (imageDataUrl) {
      result = await withTimeout(
        parseWithTieredRetries(
          { ...block, hasImage: true, imageDataUrl },
          { ...settings, preferredRoute: "vision" as const },
          provider.supportsVision,
          () => {},
        ),
        AUTO_SOLVE_PARSE_TIMEOUT_MS,
        "auto_solve_vision_retry_timeout",
      );
    }
  }

  return result;
}

async function parseBlockForAutoSolveReview(
  block: QuestionBlock,
  previousResult: ParseResult | null,
) {
  const settings = await loadSettings();
  const provider = getProvider(settings.providerId ?? "anthropic");
  const reviewSettings = buildAutoSolveReviewSettings(settings, provider.supportsVision, block);

  let parseBlock: QuestionBlock = block;
  if (provider.supportsVision) {
    const imageDataUrl = await tryCaptureBlockImageForAutoSolve(block.bbox);
    if (imageDataUrl) {
      parseBlock = { ...block, hasImage: true, imageDataUrl };
    }
  }

  let result = await withTimeout(
    parseWithTieredRetries(parseBlock, reviewSettings, provider.supportsVision, () => {}),
    AUTO_SOLVE_REVIEW_TIMEOUT_MS,
    "auto_solve_review_timeout",
  );

  if (
    provider.supportsVision &&
    parseBlock.imageDataUrl &&
    (shouldRetryWithVisionForAuto(result, block)
      || (previousResult && (result.confidence ?? 0) < Math.max(previousResult.confidence ?? 0, AUTO_SOLVE_REVIEW_CONFIDENCE_THRESHOLD)))
  ) {
    result = await withTimeout(
      parseWithTieredRetries(
        { ...block, hasImage: true, imageDataUrl: parseBlock.imageDataUrl },
        { ...reviewSettings, preferredRoute: "vision" as const },
        provider.supportsVision,
        () => {},
      ),
      AUTO_SOLVE_REVIEW_TIMEOUT_MS,
      "auto_solve_review_vision_timeout",
    );
  }

  return result;
}

function buildAutoSolveReviewSettings(
  settings: Awaited<ReturnType<typeof loadSettings>>,
  supportsVision: boolean,
  block: QuestionBlock,
) {
  const reviewModel = pickAutoSolveReviewModel(settings.providerId, settings.apiModel);
  return {
    ...settings,
    apiModel: reviewModel,
    preferredRoute: supportsVision && shouldUseVisionForAutoSolve(block, "vision") ? ("vision" as const) : ("auto" as const),
  };
}

function pickAutoSolveReviewModel(providerId: string, currentModel: string): string {
  const current = String(currentModel || "").trim();
  const provider = getProvider(providerId);
  const preferredByProvider: Partial<Record<string, string>> = {
    anthropic: "claude-opus-4-5",
    openai: "gpt-4o",
    gemini: "gemini-1.5-pro",
    qwen: "qwen-vl-max",
    zhipu: "glm-4v-plus",
    minimax: "MiniMax-M3",
    ollama: "qwen2.5-vl",
  };
  const preferred = preferredByProvider[provider.id] || provider.defaultModel;
  if (provider.models.includes(preferred) && preferred !== current) return preferred;
  if (provider.defaultModel && provider.defaultModel !== current) return provider.defaultModel;
  return current || provider.defaultModel;
}

function shouldReviewLowConfidenceHistory(entry: HistoryEntry | null): boolean {
  if (!entry) return false;
  return (entry.result.confidence ?? 0) < AUTO_SOLVE_REVIEW_CONFIDENCE_THRESHOLD;
}

function sendAutoSolveProgress(payload: {
  running: boolean;
  solved: number;
  filled: number;
  total: number;
  current: number;
  statusText: string;
  currentQuestionId?: string;
  currentPreview?: string;
}) {
  safeRuntimeSendMessage({
    type: "AUTO_SOLVE_PROGRESS",
    ...payload,
  });
}

function sendAutoSolveDone(payload: {
  ok: boolean;
  stopped?: boolean;
  solved: number;
  filled: number;
  total: number;
  message: string;
}) {
  safeRuntimeSendMessage({
    type: "AUTO_SOLVE_DONE",
    ...payload,
  });
}

function pickLiveAutoSolveBlock(): QuestionBlock | null {
  return detectZhihuishuCurrentQuestionBlock() ?? pickAutoSolveBlock(detectCandidatesInViewport());
}

function pickAutoSolveBlock(blocks: QuestionBlock[]): QuestionBlock | null {
  if (!blocks.length) return null;
  return [...blocks].sort((a, b) => {
    const scoreA = (a.confidence || 0) * 100 - a.bbox.y * 0.01;
    const scoreB = (b.confidence || 0) * 100 - b.bbox.y * 0.01;
    return scoreB - scoreA || a.bbox.y - b.bbox.y;
  })[0] ?? null;
}

function detectZhihuishuCurrentQuestionBlock(): QuestionBlock | null {
  if (!/zhihuishu\.com$/i.test(location.hostname)) return null;

  const questionBoxes = Array.from(document.querySelectorAll(".questionBox"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => !isExtensionUiElement(el))
    .filter((el) => isElementVisible(el));

  const fallbackBoxes = questionBoxes.length > 0
    ? questionBoxes
    : Array.from(document.querySelectorAll(".Classificationquestionall-div"))
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .filter((el) => !isExtensionUiElement(el))
      .filter((el) => isElementVisible(el))
      .map((el) => {
        const innerQuestionBox = el.querySelector(".questionBox");
        return innerQuestionBox instanceof HTMLElement ? innerQuestionBox : el;
      });

  const boxes = fallbackBoxes
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const text = normalizeQuestionText(el.innerText || el.textContent || "");
      return { el, rect, text, isQuestionBox: el.classList.contains("questionBox") };
    })
    .filter(({ rect, text }) => rect.width > 260 && rect.height > 80 && /^\d{1,3}\s*[\.、]/.test(text))
    .sort((a, b) => Number(b.isQuestionBox) - Number(a.isQuestionBox) || a.rect.top - b.rect.top || b.rect.height - a.rect.height);

  const chosen = boxes[0];
  if (!chosen) return null;

  const chosenBbox: BoundingBox = {
    x: Math.max(0, chosen.rect.left),
    y: Math.max(0, chosen.rect.top),
    width: chosen.rect.width,
    height: chosen.rect.height,
  };

  const resolved = resolveQuestionBlockFromBBox(chosenBbox);
  const finalBBox = resolved.finalBBox;
  const matchedCandidate = resolved.matchedCandidate;
  const previewText = resolved.previewText || chosen.text;
  const typeGuess = matchedCandidate?.questionTypeGuess ?? inferAutoSolveQuestionType(previewText || chosen.text);
  const imageUrl = matchedCandidate?.questionImageUrl ?? extractQuestionImageUrlFromBBox(finalBBox) ?? undefined;
  const hasMedia = hasVisibleAutoSolveMedia(chosen.el) || Boolean(matchedCandidate?.hasImage) || Boolean(imageUrl);

  return {
    id: `live-zhihuishu-${extractAutoSolveQuestionOrder(previewText) ?? extractAutoSolveQuestionOrder(chosen.text) ?? "x"}`,
    bbox: finalBBox,
    previewText: previewText.slice(0, 1200),
    displaySegments: matchedCandidate?.displaySegments,
    hasImage: hasMedia,
    questionImageUrl: imageUrl,
    questionTypeGuess: typeGuess,
    confidence: Math.max(0.9, matchedCandidate?.confidence ?? 0.98),
    source: "auto_dom",
  };
}

function resolveQuestionBlockFromBBox(bbox: BoundingBox): {
  refinedBBox: BoundingBox;
  finalBBox: BoundingBox;
  previewText: string;
  matchedCandidate: QuestionBlock | null;
} {
  // Snap broad or noisy selections to the most likely question container.
  const refinedBBox = refineManualBBoxToQuestionContainer(bbox);

  let previewText = extractTextFromBBox(refinedBBox);
  let finalBBox = refinedBBox;
  if (looksLikeNavigationText(previewText)) {
    const fallbackBBox = findLikelyQuestionBBoxNear(refinedBBox);
    if (fallbackBBox) {
      finalBBox = fallbackBBox;
      previewText = extractTextFromBBox(finalBBox);
    }
  }

  // Reuse the detector's normalized question card when overlap is strong.
  const matchedCandidate = findBestDetectedCandidateForBBox(finalBBox);
  if (matchedCandidate) {
    finalBBox = matchedCandidate.bbox;
    previewText = matchedCandidate.previewText || previewText;
  }

  return {
    refinedBBox,
    finalBBox,
    previewText,
    matchedCandidate,
  };
}


function getAutoSolveFingerprint(block: QuestionBlock): string {
  return getAutoSolveTextFingerprint(block.previewText || "");
}

function extractAutoSolveQuestionOrder(text: string): number | null {
  const normalized = normalizeQuestionText(text || "");
  const match = normalized.match(/^(\d{1,3})\s*[\.、]/);
  if (!match) return null;
  const order = Number(match[1]);
  return Number.isFinite(order) && order > 0 ? order : null;
}

function inferAutoSolveQuestionType(text: string): QuestionType {
  const normalized = normalizeQuestionText(text || "");
  if (/判断题/.test(normalized) || /(?:^|\n)(?:对|错)(?:\n|$)/.test(normalized)) return "judge";
  if (/填空题|_{3,}|—{2,}|﹍{2,}/.test(normalized)) return "fill_blank";
  if (/多选题/.test(normalized)) return "multi_choice";
  if (/单选题/.test(normalized)) return "single_choice";
  const optionCount = (normalized.match(/(?:^|\n)\s*[A-F][\.\):：、]/g) || []).length;
  if (optionCount >= 4) return "single_choice";
  if (optionCount >= 2) return "multi_choice";
  return "unknown";
}

function hasVisibleAutoSolveMedia(scope: Element): boolean {
  const mediaNodes = Array.from(scope.querySelectorAll("img, canvas, svg, math, figure, mjx-container, .MathJax, .katex, embed"));
  return mediaNodes.some((node) => node instanceof HTMLElement && isElementVisible(node));
}

function shouldUseVisionForAutoSolve(block: QuestionBlock, preferredRoute: "auto" | "text" | "vision"): boolean {
  if (block.hasImage) return true;
  const preview = normalizeQuestionText(block.previewText || "");
  if (/如图|下图|上图|图中|图示|根据图|看图/.test(preview)) return true;
  if (preferredRoute === "vision" && /(图|曲线|波形|根轨迹|奈奎斯特|伯德图|nyquist|bode)/i.test(preview)) return true;
  return false;
}

function getAutoSolveTextFingerprint(text: string): string {
  return normalizeQuestionText(text || "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9∞ωσ]/g, "")
    .slice(0, 120);
}

function isSameAutoSolveQuestion(a: string, b: string): boolean {
  const left = getAutoSolveTextFingerprint(a);
  const right = getAutoSolveTextFingerprint(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 24 && right.length >= 24 && (left.includes(right) || right.includes(left))) return true;

  const minLen = Math.min(left.length, right.length);
  let prefix = 0;
  while (prefix < minLen && left[prefix] === right[prefix]) prefix += 1;
  return prefix >= Math.max(20, Math.floor(minLen * 0.72));
}

function findReusableHistoryEntry(history: HistoryEntry[], block: QuestionBlock): HistoryEntry | null {
  for (const entry of history) {
    if (entry.host && entry.host !== location.hostname) continue;
    if (isSameAutoSolveQuestion(block.previewText || "", entry.block.previewText || "")) return entry;
    if (isSameAutoSolveQuestion(block.previewText || "", entry.result.recognizedText || "")) return entry;
  }
  return null;
}

function detectTotalQuestionCount(): number {
  const containers = Array.from(document.querySelectorAll("div,section,aside,article"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => !isExtensionUiElement(el))
    .filter((el) => /答题卡/.test(normalizeQuestionText(el.innerText || el.textContent || "")));

  for (const container of containers) {
    const nums = Array.from(container.querySelectorAll("button,span,div,a,li"))
      .map((el) => normalizeQuestionText((el as HTMLElement).innerText || el.textContent || ""))
      .filter((text) => /^\d{1,3}$/.test(text))
      .map((text) => Number(text))
      .filter((num) => num > 0 && num <= 300);
    if (nums.length) return Math.max(...nums);
  }

  return 0;
}

function inspectAutoSolveAnswerState(block: QuestionBlock): {
  mode: "choice" | "text" | "none";
  answeredCount: number;
  totalCount: number;
  complete: boolean;
} {
  const textControls = Array.from(document.querySelectorAll("input:not([type='radio']):not([type='checkbox']):not([type='hidden']):not([type='button']):not([type='submit']), textarea, [contenteditable='true']"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => rectIntersectsExpandedBBox(el.getBoundingClientRect(), block.bbox, 40, 320));
  if (textControls.length > 0) {
    const answeredCount = textControls.filter((el) => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return Boolean(String(el.value || "").trim());
      if (el.isContentEditable) return Boolean(String(el.textContent || "").trim());
      return false;
    }).length;
    return {
      mode: "text",
      answeredCount,
      totalCount: textControls.length,
      complete: answeredCount > 0 && answeredCount === textControls.length,
    };
  }

  const choiceInputs = Array.from(document.querySelectorAll("input[type='radio'], input[type='checkbox']"))
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
    .filter((el) => rectIntersectsExpandedBBox(el.getBoundingClientRect(), block.bbox, 28, 260));
  if (choiceInputs.length > 0) {
    const answeredCount = choiceInputs.filter((el) => el.checked).length;
    return {
      mode: "choice",
      answeredCount,
      totalCount: choiceInputs.length,
      complete: answeredCount > 0,
    };
  }

  return { mode: "none", answeredCount: 0, totalCount: 0, complete: false };
}

function rectIntersectsExpandedBBox(rect: DOMRect, bbox: BoundingBox, verticalPad: number, horizontalPad: number): boolean {
  return !(
    rect.right < bbox.x - horizontalPad
    || rect.left > bbox.x + bbox.width + horizontalPad
    || rect.bottom < bbox.y - verticalPad
    || rect.top > bbox.y + bbox.height + verticalPad
  );
}

function findNextQuestionButton(): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll("button,a,span,div"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => !isExtensionUiElement(el))
    .filter((el) => isElementVisible(el))
    .filter((el) => /下一题|next/i.test(normalizeQuestionText(el.innerText || el.textContent || "")));

  const enabled = nodes.filter((el) => !isElementDisabled(el));
  const ranked = (enabled.length ? enabled : nodes).sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return br.top - ar.top || br.left - ar.left;
  });

  return ranked[0] ?? null;
}

function clickNextQuestionButton(): boolean {
  const nextButton = findNextQuestionButton();
  if (!nextButton || isElementDisabled(nextButton)) return false;
  triggerUiClick(nextButton);
  return true;
}

async function waitForQuestionAdvance(previousFingerprint: string, previousOrder: number | null, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (autoSolveStopRequested) return false;
    await pauseMs(350);
    const currentBlock = pickLiveAutoSolveBlock();
    if (!currentBlock) continue;
    const nextFingerprint = getAutoSolveFingerprint(currentBlock);
    const nextOrder = extractAutoSolveQuestionOrder(currentBlock.previewText || "");
    if (previousOrder !== null && nextOrder !== null && nextOrder !== previousOrder) return true;
    if (nextFingerprint && nextFingerprint !== previousFingerprint) return true;
  }
  return false;
}

function shouldStopAutoSolveAtTail(currentOrder: number | null, total: number): boolean {
  return total > 0 && currentOrder !== null && currentOrder >= total;
}

function isElementDisabled(el: HTMLElement): boolean {
  if ("disabled" in el && typeof (el as HTMLButtonElement).disabled === "boolean") {
    if ((el as HTMLButtonElement).disabled) return true;
  }
  const ariaDisabled = el.getAttribute("aria-disabled");
  if (ariaDisabled === "true") return true;
  const cls = String(el.className || "");
  return /disabled|is-disabled/.test(cls);
}

function triggerUiClick(target: HTMLElement) {
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  target.click();
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

function pauseMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function looksMathHeavyForAuto(text: string): boolean {
  const t = String(text || "");
  if (!t) return false;
  return /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|\bkv\b|s\^|\/|=\s*0|jω|jw|ω|σ|∫|Σ|√|传递函数|积分环节|稳态误差|奈奎斯特|伯德图|如图|图中|下图|上图)/i.test(t);
}

function shouldRetryWithVisionForAuto(
  result: Awaited<ReturnType<typeof parseQuestion>>,
  block: QuestionBlock,
): boolean {
  if ((result.confidence ?? 0) < 0.5) return true;
  const s = `${result.warning ?? ""} ${result.briefExplanation ?? ""}`.toLowerCase();
  if (/(选项缺失|无法判断|无法确定|无法作答|missing options|incomplete)/i.test(s)) return true;

  if ((block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice") && !/^[A-F](?:\s*[,，、/|]\s*[A-F])*$/i.test(String(result.answer || "").trim())) {
    return true;
  }

  if (block.questionTypeGuess === "judge" && !/^(对|错|正确|错误|true|false)$/i.test(String(result.answer || "").trim())) {
    return true;
  }

  if (block.questionTypeGuess === "fill_blank") {
    const expectedParts = countExpectedBlankParts(block.previewText || "");
    const actualParts = splitAnswerParts(String(result.answer || ""), Math.max(expectedParts, 1)).length;
    if (expectedParts > 1 && actualParts < expectedParts) return true;
  }

  return false;
}

function countExpectedBlankParts(text: string): number {
  const normalized = String(text || "");
  const decimalLabels = normalized.match(/\d+\.\d+/g) || [];
  if (decimalLabels.length) return new Set(decimalLabels).size;
  const indexedLabels = normalized.match(/[（(]\d+[)）]/g) || [];
  if (indexedLabels.length) return new Set(indexedLabels).size;
  const blankMarkers = normalized.match(/_{3,}|—{2,}|﹍{2,}/g) || [];
  return blankMarkers.length;
}

// 鈹€鈹€鈹€ Screenshot with retry 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function screenshotWithRetry(maxAttempts = 3): Promise<string | null> {
  let lastErr = "";
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    const res = await sendToBackgroundWithTimeout<{ dataUrl?: string; error?: string }>(
      { type: "CAPTURE_TAB_SCREENSHOT" },
      30_000,
    );
    if (res?.dataUrl) return res.dataUrl;
    if (res?.error) {
      lastErr = res.error;
      console.warn("[Capture] screenshot attempt failed:", res.error);
    } else if (!res) {
      lastErr = "timeout";
      console.warn("[Capture] screenshot attempt timed out");
    }
  }
  if (lastErr) {
    throw new Error(`截图失败：${lastErr}`);
  }
  return null;
}

async function captureBlockImage(bbox: BoundingBox): Promise<string | null> {
  const dataUrl = await screenshotWithRetry();
  if (!dataUrl) return null;
  return cropScreenshot(dataUrl, bbox, window.devicePixelRatio);
}

async function tryCaptureBlockImageForAutoSolve(bbox: BoundingBox): Promise<string | null> {
  try {
    return await captureBlockImage(bbox);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/activeTab/i.test(message) || /has not been in invoked/i.test(message)) {
      console.warn("[AutoSolve] capture skipped due to missing activeTab grant:", message);
      return null;
    }
    throw err;
  }
}

async function sendToBackgroundWithTimeout<R>(message: ExtMessage, timeoutMs: number): Promise<R | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([
    sendToBackground<R>(message),
    timeoutPromise,
  ]);
}

// 鈹€鈹€鈹€ Extract text from bbox area using DOM 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function extractTextFromBBox(bbox: BoundingBox): string {
  const anchored = extractTextFromAnchoredContainer(bbox);
  if (anchored.trim().length > 0) return anchored.slice(0, 1200);

  const regionText = collectTextFromRegion(bbox);
  if (regionText.trim().length > 0) return regionText.slice(0, 1200);

  const samplePoints: Array<{ x: number; y: number }> = [
    { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
    { x: bbox.x + 8, y: bbox.y + 8 },
    { x: bbox.x + bbox.width - 8, y: bbox.y + 8 },
    { x: bbox.x + 8, y: bbox.y + bbox.height - 8 },
    { x: bbox.x + bbox.width - 8, y: bbox.y + bbox.height - 8 },
  ];

  const seedElements: Element[] = [];
  for (const p of samplePoints) {
    const el = document.elementFromPoint(p.x, p.y);
    if (!el || isExtensionUiElement(el)) continue;
    if (!seedElements.includes(el)) seedElements.push(el);
  }
  if (seedElements.length === 0) return "";

  let bestText = "";
  let bestScore = -Infinity;

  for (const seed of seedElements) {
    let node: Element | null = seed;
    for (let depth = 0; depth < 9 && node; depth++) {
      if (isExtensionUiElement(node)) {
        node = node.parentElement;
        continue;
      }
      const text = normalizeQuestionText((node as HTMLElement).innerText || node.textContent || "");
      const score = scoreQuestionLikeText(text, node, depth);
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
      node = node.parentElement;
    }
  }

  return bestText.slice(0, 1200);
}

function extractQuestionImageUrlFromBBox(bbox: BoundingBox): string | null {
  const anchor = pickAnchorElement(bbox);
  const scope = anchor ? (findBestQuestionContainer(anchor, bbox) ?? document.body) : document.body;
  const images = Array.from(scope.querySelectorAll("img")) as HTMLImageElement[];
  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const img of images) {
    if (!isElementVisible(img)) continue;
    if (findNearbySemanticFormulaTextForImage(img)) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) continue;
    const inter = intersectionArea(rect, bbox);
    if (inter <= 0) continue;
    const score = inter + rect.width * rect.height * 0.05;
    if (score > bestScore) {
      const url = (img.currentSrc || img.src || "").trim();
      if (url) {
        bestScore = score;
        bestUrl = url;
      }
    }
  }
  return bestUrl;
}

function extractTextFromAnchoredContainer(bbox: BoundingBox): string {
  const anchor = pickAnchorElement(bbox);
  if (!anchor) return "";
  const container = findBestQuestionContainer(anchor, bbox);
  if (!container) return "";

  const text = collectTextFromContainer(container, bbox);
  if (text.trim().length > 0) return text;

  // Fallback to container text if descendant extraction is sparse.
  return normalizeQuestionText((container as HTMLElement).innerText || container.textContent || "");
}

function pickAnchorElement(bbox: BoundingBox): Element | null {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const els = document.elementsFromPoint(cx, cy);
  for (const el of els) {
    if (!isExtensionUiElement(el)) return el;
  }
  return null;
}

function findBestQuestionContainer(anchor: Element, bbox: BoundingBox): Element | null {
  let node: Element | null = anchor;
  let best: Element | null = null;
  let bestScore = -Infinity;
  const bboxArea = Math.max(1, bbox.width * bbox.height);

  for (let depth = 0; depth < 12 && node; depth++) {
    if (isExtensionUiElement(node)) {
      node = node.parentElement;
      continue;
    }
    const rect = node.getBoundingClientRect();
    const interArea = intersectionArea(rect, bbox);
    if (interArea <= 0) {
      node = node.parentElement;
      continue;
    }

    const nodeArea = Math.max(1, rect.width * rect.height);
    const areaRatio = nodeArea / bboxArea;
    const overlapRatio = interArea / Math.min(nodeArea, bboxArea);
    const text = normalizeQuestionText((node as HTMLElement).innerText || node.textContent || "");
    const optionLikeCount = (
      text.match(/(?:^|\n)\s*(?:[A-D][\.\):\uFF1A\u3001]?|[\u2460\u2461\u2462\u2463])\s*/g) || []
    ).length;
    const hasQuestion = /[?\uFF1F]/.test(text);

    let score = 0;
    score += overlapRatio * 100;
    score += optionLikeCount * 20;
    if (hasQuestion) score += 20;
    if (areaRatio < 0.5) score -= 30;
    if (areaRatio > 8) score -= 60;
    if (node.tagName === "BODY" || node.tagName === "HTML") score -= 200;
    score -= depth * 4;

    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
    node = node.parentElement;
  }

  return best;
}

function refineManualBBoxToQuestionContainer(bbox: BoundingBox): BoundingBox {
  const detectedCandidate = findBestDetectedCandidateForBBox(bbox);
  if (detectedCandidate) {
    const detectedArea = Math.max(1, detectedCandidate.bbox.width * detectedCandidate.bbox.height);
    const originalArea = Math.max(1, bbox.width * bbox.height);
    if (detectedArea <= originalArea * 2.6) {
      return detectedCandidate.bbox;
    }
  }

  const strictCard = findStrictQuestionCardBBox(bbox);
  if (strictCard) return strictCard;

  const anchor = pickAnchorElement(bbox);
  if (!anchor) return bbox;
  const container = findBestQuestionContainer(anchor, bbox);
  if (!container) return bbox;

  const rect = container.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 80) return bbox;

  const snapped: BoundingBox = {
    x: Math.max(0, rect.left),
    y: Math.max(0, rect.top),
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };

  // If snapped area is unreasonably huge, keep original to avoid over-expansion.
  const origArea = Math.max(1, bbox.width * bbox.height);
  const snapArea = Math.max(1, snapped.width * snapped.height);
  if (snapArea > origArea * 4) return bbox;
  if (snapArea < origArea * 0.2) return bbox;

  // Avoid snapping from a single-question drag into a multi-question container.
  const snappedText = extractTextFromBBox(snapped);
  if (hasLikelyMultipleQuestionStarts(snappedText)) return bbox;
  return snapped;
}

function findStrictQuestionCardBBox(bbox: BoundingBox): BoundingBox | null {
  const cards = Array.from(document.querySelectorAll("#qlist-container .q-detail, .card.q-detail, .card.mb-3.q-detail")) as HTMLElement[];
  if (cards.length === 0) return null;

  const bx = bbox.x + bbox.width / 2;
  const by = bbox.y + bbox.height / 2;
  let bestRect: DOMRect | null = null;
  let bestScore = -Infinity;

  for (const card of cards) {
    if (!isElementVisible(card)) continue;
    const r = card.getBoundingClientRect();
    if (r.width < 280 || r.height < 140) continue;
    const inter = intersectionArea(r, bbox);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.hypot(cx - bx, cy - by);
    const score = inter * 1.2 - dist + Math.min((r.width * r.height) / 3000, 180);
    if (score > bestScore) {
      bestScore = score;
      bestRect = r;
    }
  }

  if (!bestRect) return null;
  return {
    x: Math.max(0, bestRect.left),
    y: Math.max(0, bestRect.top),
    width: Math.max(1, bestRect.width),
    height: Math.max(1, bestRect.height),
  };
}

function looksLikeNavigationText(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  const navHits = [
    "试题检索",
    "教材版本",
    "课本",
    "题型",
    "难易度",
    "按章节",
    "按知识点",
    "组卷预览",
  ].filter((k) => t.includes(k)).length;
  const questionHints = /(A[、.．]|B[、.．]|C[、.．]|D[、.．]|\(\s*1\s*\)|（\s*1\s*）|请据图回答|下列)/.test(t);
  if (navHits >= 2 && !questionHints) return true;
  return false;
}

function findLikelyQuestionBBoxNear(bbox: BoundingBox): BoundingBox | null {
  const strict = findStrictQuestionCardBBox(bbox);
  if (strict) return strict;

  const questionLikeNodes = Array.from(document.querySelectorAll("div,p,li"))
    .filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (!isElementVisible(el) || isExtensionUiElement(el)) return false;
      const txt = normalizeQuestionText(el.innerText || el.textContent || "");
      if (txt.length < 40 || txt.length > 5000) return false;
      return /(A[、.．]|B[、.．]|C[、.．]|D[、.．]|\(\s*1\s*\)|（\s*1\s*）|请据图回答|下列)/.test(txt);
    }) as HTMLElement[];

  let best: DOMRect | null = null;
  let bestScore = -Infinity;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  for (const el of questionLikeNodes) {
    const r = el.getBoundingClientRect();
    if (r.width < 260 || r.height < 120) continue;
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const dist = Math.hypot(dx, dy);
    const area = r.width * r.height;
    const score = -dist + Math.min(area / 2000, 120);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best) return null;
  return {
    x: Math.max(0, best.left),
    y: Math.max(0, best.top),
    width: Math.max(1, best.width),
    height: Math.max(1, Math.min(best.height, 900)),
  };
}

function findBestDetectedCandidateForBBox(bbox: BoundingBox): QuestionBlock | null {
  const cands = detectCandidatesInViewport();
  if (!cands.length) return null;

  const bboxArea = Math.max(1, bbox.width * bbox.height);
  const bx = bbox.x + bbox.width / 2;
  const by = bbox.y + bbox.height / 2;
  let best: QuestionBlock | null = null;
  let bestScore = -Infinity;

  for (const cand of cands) {
    const cb = cand.bbox;
    const inter = intersectionArea(
      { left: cb.x, top: cb.y, width: cb.width, height: cb.height, right: cb.x + cb.width, bottom: cb.y + cb.height } as DOMRect,
      bbox,
    );
    if (inter <= 0) continue;

    const candArea = Math.max(1, cb.width * cb.height);
    const overlapRatio = inter / Math.min(bboxArea, candArea);
    const centerInside =
      bx >= cb.x &&
      bx <= cb.x + cb.width &&
      by >= cb.y &&
      by <= cb.y + cb.height;
    // Require either strong overlap or explicit center hit to avoid snapping
    // into neighboring cards when manual drag crosses boundaries.
    if (!centerInside && overlapRatio < 0.55) continue;

    const cx = cb.x + cb.width / 2;
    const cy = cb.y + cb.height / 2;
    const dist = Math.hypot(cx - bx, cy - by);
    const score =
      overlapRatio * 120 +
      Math.min(candArea / bboxArea, 4) * 6 +
      (cand.confidence || 0) * 20 -
      dist * 0.08;

    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return best;
}

function collectTextFromContainer(container: Element, bbox: BoundingBox): string {
  const selector = "h1,h2,h3,h4,p,li,td,label,span,div,img,svg,math,figure,mjx-container,.MathJax,.katex,embed";
  const nodes = Array.from(container.querySelectorAll(selector));
  const entries: Array<{ top: number; left: number; text: string }> = [];

  for (const node of nodes) {
    if (isExtensionUiElement(node)) continue;
    if (node instanceof HTMLElement && !isElementVisible(node)) continue;
    const rect = (node as Element).getBoundingClientRect();
    const interArea = intersectionArea(rect, bbox);
    if (interArea < 8) continue;
    if (rect.width < 2 || rect.height < 2) continue;

    const text = extractReadableQuestionNodeText(node);
    if (!text) continue;
    if (text.length > 320) continue;
    entries.push({ top: rect.top, left: rect.left, text });
  }

  return mergeTextEntries(entries);
}

function collectTextFromRegion(bbox: BoundingBox): string {
  const textEntries: Array<{ top: number; left: number; text: string }> = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const parent = textNode.parentElement;
    const rawText = textNode.textContent ?? "";
    if (
      parent &&
      !isExtensionUiElement(parent) &&
      rawText.trim().length > 0 &&
      isElementVisible(parent) &&
      !isSemanticFormulaTextNodeParent(parent)
    ) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = Array.from(range.getClientRects());
      range.detach?.();

      let bestRect: DOMRect | null = null;
      let bestArea = 0;
      for (const rect of rects) {
        const area = intersectionArea(rect, bbox);
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

  const mergedFromTextNodes = mergeTextEntries(textEntries);
  if (looksLikeQuestionBlock(mergedFromTextNodes)) return mergedFromTextNodes.slice(0, 1200);

  // Fallback: element-level extraction when text-node rects are sparse.
  const selector = "h1,h2,h3,h4,p,li,td,label,span,img,svg,math,figure,mjx-container,.MathJax,.katex,embed";
  const nodes = Array.from(document.querySelectorAll(selector));
  const entries: Array<{ top: number; left: number; text: string }> = [];

  for (const node of nodes) {
    if (isExtensionUiElement(node)) continue;
    if (node instanceof HTMLElement) {
      if (node.offsetParent === null) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") continue;
    }

    const rect = (node as Element).getBoundingClientRect();
    if (!rectIntersectsBBox(rect, bbox)) continue;
    if (rect.width < 2 || rect.height < 2) continue;

    const text = extractReadableQuestionNodeText(node);
    if (!text) continue;
    if (text.length > 220) continue; // skip large container-like nodes

    entries.push({ top: rect.top, left: rect.left, text });
  }

  return mergeTextEntries(entries).slice(0, 1200);
}

function normalizeInlineText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isSemanticFormulaTextNodeParent(parent: HTMLElement): boolean {
  return Boolean(
    parent.closest("svg,math,mjx-container,.MathJax,.katex,embed,[data-svg-latex],[data-latex]"),
  );
}

function extractReadableQuestionNodeText(node: Element): string {
  const tag = node.tagName.toLowerCase();
  const attrText = [
    node.getAttribute("aria-label"),
    node.getAttribute("alt"),
    node.getAttribute("title"),
    node.getAttribute("data-alt"),
  ].find((v) => normalizeQuestionText(v || ""));

  if (tag === "img") {
    const formulaText = findNearbySemanticFormulaTextForImage(node);
    if (formulaText) return "";
    return normalizeQuestionText(attrText || "[图片]");
  }
  if (tag === "embed") {
    const latex = decodeFormulaLikeText(
      node.getAttribute("data-svg-latex")
      || node.getAttribute("data-latex")
      || node.getAttribute("alt")
      || node.getAttribute("title")
      || "",
    );
    return normalizeQuestionText(latex || attrText || "[公式]");
  }
  if (tag === "canvas") {
    return normalizeQuestionText(attrText || "[图形]");
  }
  if (tag === "svg" || tag === "math" || tag === "mjx-container") {
    if (hasNearbyLargeVisualImageForSemanticNode(node)) return "";
    return normalizeQuestionText(extractSemanticSvgLikeText(node) || "[公式]");
  }
  if (node.matches(".MathJax, .katex")) {
    if (hasNearbyLargeVisualImageForSemanticNode(node)) return "";
    return normalizeQuestionText(extractSemanticSvgLikeText(node) || "[公式]");
  }
  return normalizeQuestionText((node as HTMLElement).innerText || node.textContent || attrText || "");
}

function mergeTextEntries(entries: Array<{ top: number; left: number; text: string }>): string {
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

function rectIntersectsBBox(rect: DOMRect, bbox: BoundingBox): boolean {
  const x1 = Math.max(rect.left, bbox.x);
  const y1 = Math.max(rect.top, bbox.y);
  const x2 = Math.min(rect.right, bbox.x + bbox.width);
  const y2 = Math.min(rect.bottom, bbox.y + bbox.height);
  return x2 > x1 && y2 > y1;
}

function intersectionArea(rect: DOMRect, bbox: BoundingBox): number {
  const x1 = Math.max(rect.left, bbox.x);
  const y1 = Math.max(rect.top, bbox.y);
  const x2 = Math.min(rect.right, bbox.x + bbox.width);
  const y2 = Math.min(rect.bottom, bbox.y + bbox.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function isElementVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null) return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (style.opacity === "0") return false;
  return true;
}

function isExtensionUiElement(el: Element): boolean {
  if ((el.id && el.id.startsWith("qs-")) || !!el.closest("[id^='qs-']")) return true;
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    const hostId = root.host?.id ?? "";
    if (hostId.startsWith("qs-")) return true;
  }
  return false;
}

function normalizeQuestionText(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !isNoiseLine(line));
  // Keep line breaks so option structures (A/B/C/D, 鈶犫憽鈶⑩懀) are not flattened.
  const cleaned = lines.join("\n");
  return normalizeMathDisplayText(stripLikelyTrailingCodeOrJson(cleaned));
}

function isNoiseLine(line: string): boolean {
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

function stripLikelyTrailingCodeOrJson(text: string): string {
  const t = String(text || "");
  if (!t) return t;
  const cutMarkers = ["```json", "```", "[", "{\n\"questionType\"", "\"questionType\":"];
  let cut = -1;
  for (const m of cutMarkers) {
    const idx = t.indexOf(m);
    if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
  }
  const out = cut >= 0 ? t.slice(0, cut).trim() : t.trim();
  return out;
}

function hasLikelyMultipleQuestionStarts(text: string): boolean {
  const t = String(text || "");
  if (!t) return false;
  const starts = t.match(/(?:^|\n)\s*(?:\d{1,2}[、\.\)]|[（(]\d{1,2}[)）]|第\s*\d+\s*题)/g) || [];
  return starts.length >= 2;
}

function looksLikeQuestionBlock(text: string): boolean {
  if (text.length < 20) return false;
  const hasQuestion = /[?\uFF1F]/.test(text);
  const optionLikeCount = (
    text.match(/(?:^|\n)\s*(?:[A-D][\.\):\uFF1A\u3001]?|[\u2460\u2461\u2462\u2463])\s*/g) || []
  ).length;
  return hasQuestion && optionLikeCount >= 2;
}

function scoreQuestionLikeText(text: string, node: Element, depth: number): number {
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

// 鈹€鈹€鈹€ Full Page Detect 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function handleFullPageDetect() {
  if (isFullPageScanRunning()) {
    cancelFullPageScan();
    return;
  }

  logEvent("auto_detect_started", { mode: "full_page" });

  // Clear existing highlights
  highlightLayer?.destroy();
  highlightLayer = null;
  unwatchSPA?.();
  unwatchSPA = null;
  candidateStatusMap.clear();
  activeCandidates = [];
  activeHighlightBlocks = [];
  activeDetectMode = "fullpage";
  refreshLayoutResizeObservation();

  // Notify sidepanel scan started with 0%
  safeRuntimeSendMessage({
    type: "FULL_PAGE_DETECT_PROGRESS",
    progress: 0,
    found: 0,
    currentStep: 0,
    totalScrollSteps: 1,
  });

  try {
    const roughCandidates = await detectCandidatesFullPage((p) => {
      safeRuntimeSendMessage({
        type: "FULL_PAGE_DETECT_PROGRESS",
        progress: p.progress,
        found: p.found,
        currentStep: p.currentStep,
        totalScrollSteps: p.totalScrollSteps,
      });
    });
    const candidates = await refineFullPageCandidatesViaManualPipeline(roughCandidates);
    const scrollRoot = resolveFullPageScrollRoot();
    lastFullPageLayoutKey = getFullPageLayoutKey(scrollRoot);

    logEvent("auto_detect_candidates_found", { count: candidates.length, mode: "full_page" });

    activeCandidates = candidates;
    activeHighlightBlocks = candidates;

    candidates.forEach(b => candidateStatusMap.set(b.id, { status: "pending", selected: false }));

    highlightLayer = new HighlightLayer({
      coordinateSpace: "scroll-root",
      scrollRoot,
      onSelect: (blockId, selected) => {
        const s = candidateStatusMap.get(blockId);
        if (s) {
          s.selected = selected;
          if (highlightLayer) highlightLayer.setBlocks(activeHighlightBlocks, candidateStatusMap);
        }
        logEvent("auto_detect_candidate_selected", { blockId, selected });
        notifySidePanel(activeCandidates);
      },
    });
    refreshFullPageHighlightsAfterLayoutChange();

    safeRuntimeSendMessage({
      type: "FULL_PAGE_DETECT_DONE",
      candidates,
      totalFound: candidates.length,
    });

  } catch (err) {
    console.error("[QS] Full page detect error:", err);
    activeCandidates = [];
    activeHighlightBlocks = [];
    lastFullPageLayoutKey = "";
    refreshLayoutResizeObservation();
    safeRuntimeSendMessage({
      type: "FULL_PAGE_DETECT_DONE",
      candidates: [],
      totalFound: 0,
    });
  }
}

async function refineFullPageCandidatesViaManualPipeline(candidates: QuestionBlock[]): Promise<QuestionBlock[]> {
  if (!candidates.length) return [];

  const scrollRoot = resolveFullPageScrollRoot();
  const originalTop = getScrollTop(scrollRoot);
  const originalLeft = getScrollLeft(scrollRoot);
  const refined: QuestionBlock[] = [];
  const seen = new Set<string>();

  try {
    for (const candidate of [...candidates].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)) {
      if (autoSolveStopRequested) break;

      const targetTop = Math.max(0, candidate.bbox.y - Math.max(96, Math.floor(window.innerHeight * 0.16)));
      setScrollPosition(scrollRoot, targetTop, originalLeft);
      await pauseFullPage(220);

      const viewportBBox = projectAbsoluteBboxToViewport(candidate.bbox, scrollRoot);

      const visibleCandidates = detectCandidatesInViewport();
      const viewportTarget: QuestionBlock = {
        ...candidate,
        bbox: viewportBBox,
      };
      const matchedVisibleCandidate =
        findMatchingCandidate(visibleCandidates, viewportTarget)
        ?? findBestVisibleCandidateByOrder(visibleCandidates, candidate);

      const resolved = resolveQuestionBlockFromBBox(viewportBBox);
      const rawPreviewText = extractTextFromBBox(resolved.finalBBox);
      const matchedCandidate = matchedVisibleCandidate ?? resolved.matchedCandidate;
      const typeGuess = matchedCandidate?.questionTypeGuess ?? candidate.questionTypeGuess ?? inferAutoSolveQuestionType(rawPreviewText || candidate.previewText);
      const richPreviewText = matchedVisibleCandidate?.previewText || resolved.previewText || matchedCandidate?.previewText || candidate.previewText;
      const previewText = shouldPreferViewportPreview(rawPreviewText, richPreviewText, matchedCandidate)
        ? richPreviewText
        : (pickBestAutoSolvePreviewText(rawPreviewText, richPreviewText, typeGuess) || richPreviewText || rawPreviewText);
      const imageUrl = matchedVisibleCandidate?.questionImageUrl
        ?? matchedCandidate?.questionImageUrl
        ?? extractQuestionImageUrlFromBBox(resolved.finalBBox)
        ?? candidate.questionImageUrl;
      const hasImage = Boolean(imageUrl) || Boolean(matchedCandidate?.hasImage) || candidate.hasImage;
      const finalViewportBBox = matchedVisibleCandidate?.bbox ?? resolved.finalBBox;
      const absoluteBBox = projectViewportBboxToAbsolute(finalViewportBBox, scrollRoot);

      const order = extractAutoSolveQuestionOrder(previewText) ?? extractAutoSolveQuestionOrder(candidate.previewText);
      const fingerprint = `${order ?? "x"}:${getAutoSolveTextFingerprint(previewText)}`;
      if (fingerprint.length > 4 && seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      refined.push({
        ...candidate,
        bbox: absoluteBBox,
        previewText: previewText.slice(0, 1200),
        displaySegments: matchedVisibleCandidate?.displaySegments ?? matchedCandidate?.displaySegments ?? candidate.displaySegments,
        questionImageUrl: imageUrl,
        hasImage,
        questionTypeGuess: typeGuess,
        confidence: Math.max(candidate.confidence ?? 0, matchedCandidate?.confidence ?? 0.9),
      });
    }
  } finally {
    setScrollPosition(scrollRoot, originalTop, originalLeft);
  }

  return refined.length ? refined : candidates;
}

function projectAbsoluteBboxToViewport(bbox: BoundingBox, scrollRoot: ScanScrollRoot): BoundingBox {
  if (scrollRoot === window) {
    return {
      x: bbox.x - getScrollLeft(scrollRoot),
      y: bbox.y - getScrollTop(scrollRoot),
      width: bbox.width,
      height: bbox.height,
    };
  }

  const elementRoot = scrollRoot as HTMLElement;
  const rect = elementRoot.getBoundingClientRect();
  return {
    x: rect.left + bbox.x - elementRoot.scrollLeft,
    y: rect.top + bbox.y - elementRoot.scrollTop,
    width: bbox.width,
    height: bbox.height,
  };
}

function projectViewportBboxToAbsolute(bbox: BoundingBox, scrollRoot: ScanScrollRoot): BoundingBox {
  if (scrollRoot === window) {
    return {
      x: bbox.x + getScrollLeft(scrollRoot),
      y: bbox.y + getScrollTop(scrollRoot),
      width: bbox.width,
      height: bbox.height,
    };
  }

  const elementRoot = scrollRoot as HTMLElement;
  const rect = elementRoot.getBoundingClientRect();
  return {
    x: bbox.x - rect.left + elementRoot.scrollLeft,
    y: bbox.y - rect.top + elementRoot.scrollTop,
    width: bbox.width,
    height: bbox.height,
  };
}

function findBestVisibleCandidateByOrder(
  visibleCandidates: QuestionBlock[],
  target: QuestionBlock,
): QuestionBlock | null {
  const targetOrder = extractAutoSolveQuestionOrder(target.previewText || "");
  if (targetOrder === null) return null;

  let best: QuestionBlock | null = null;
  let bestScore = -Infinity;
  for (const candidate of visibleCandidates) {
    const candidateOrder = extractAutoSolveQuestionOrder(candidate.previewText || "");
    if (candidateOrder !== targetOrder) continue;
    let score = 0;
    if (candidate.questionTypeGuess === target.questionTypeGuess) score += 20;
    score += candidate.confidence ?? 0;
    score += Math.max(0, 800 - Math.abs(candidate.bbox.y - target.bbox.y)) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function shouldPreferViewportPreview(
  rawPreviewText: string,
  richPreviewText: string,
  matchedCandidate?: QuestionBlock | null,
): boolean {
  if (!richPreviewText) return false;
  if (!rawPreviewText) return true;
  if (Boolean(matchedCandidate?.questionImageUrl)) return true;
  if (looksLikeGarbledFullPageText(rawPreviewText) && !looksLikeGarbledFullPageText(richPreviewText)) return true;
  return false;
}

function looksLikeGarbledFullPageText(text: string): boolean {
  const normalized = normalizeQuestionText(text || "");
  if (!normalized) return false;
  if (/TXXXX\^|q q|x x x|=\s*=\s*=|(?:^|\s)[qθωσ]\s+\d(?:\s+\d){2,}/i.test(normalized)) return true;
  if (/(?:取得样本值|取样本值).{0,24}(?:q|x)\s*\d(?:[\s,.\-+=()]*\d){2,}/.test(normalized)) return true;
  return false;
}

// 鈹€鈹€鈹€ Auto Detect 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function handleAutoDetect() {
  logEvent("auto_detect_started");
  highlightLayer?.destroy();
  unwatchSPA?.();
  candidateStatusMap.clear();
  activeCandidates = [];
  activeHighlightBlocks = [];
  activeDetectMode = "viewport";

  const candidates = detectCandidatesInViewport();
  activeCandidates = candidates;
  activeHighlightBlocks = candidates;
  logEvent("auto_detect_candidates_found", { count: candidates.length });

  notifySidePanel(candidates);
  if (candidates.length === 0) return;

  candidates.forEach(b => candidateStatusMap.set(b.id, { status: "pending", selected: false }));

  highlightLayer = new HighlightLayer({
    onSelect: (blockId, selected) => {
        const s = candidateStatusMap.get(blockId);
        if (s) {
          s.selected = selected;
          if (highlightLayer) highlightLayer.setBlocks(activeHighlightBlocks, candidateStatusMap);
        }
      logEvent("auto_detect_candidate_selected", { blockId, selected });
      notifySidePanel(activeCandidates);
    },
  });
  highlightLayer.setBlocks(activeHighlightBlocks, candidateStatusMap);

  // SPA watch: re-detect when page content changes
  unwatchSPA = watchForPageChanges((newBlocks) => {
    // Only update if substantially different
    if (Math.abs(newBlocks.length - candidates.length) > 2) {
      activeCandidates = newBlocks;
      activeHighlightBlocks = newBlocks;
      notifySidePanel(newBlocks);
    }
  });
}

function findMatchingCandidate(candidates: QuestionBlock[], target: QuestionBlock): QuestionBlock | null {
  let best: QuestionBlock | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const score = scoreCandidateMatch(candidate, target);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 60 ? best : null;
}

function findMatchingFullPageCandidate(
  candidates: QuestionBlock[],
  target: QuestionBlock,
  usedIds: Set<string>,
): QuestionBlock | null {
  const targetText = normalizeCandidatePreview(target.previewText);
  const targetOrder = extractAutoSolveQuestionOrder(target.previewText);
  let best: QuestionBlock | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (usedIds.has(candidate.id)) continue;

    const candidateText = normalizeCandidatePreview(candidate.previewText);
    const candidateOrder = extractAutoSolveQuestionOrder(candidate.previewText);
    let score = 0;

    if (candidateText && targetText && candidateText === targetText) score += 120;
    if (candidateOrder !== null && targetOrder !== null && candidateOrder === targetOrder) score += 90;
    if (candidate.questionTypeGuess === target.questionTypeGuess) score += 15;
    if (candidateText && targetText && (candidateText.includes(targetText) || targetText.includes(candidateText))) score += 40;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 70 ? best : null;
}

function scoreCandidateMatch(a: QuestionBlock, b: QuestionBlock): number {
  const overlap = bboxOverlapRatio(a.bbox, b.bbox);
  const textA = normalizeCandidatePreview(a.previewText);
  const textB = normalizeCandidatePreview(b.previewText);
  const sameFingerprint = textA && textB && textA === textB;
  const sameType = a.questionTypeGuess === b.questionTypeGuess;

  let score = overlap * 100;
  if (sameFingerprint) score += 80;
  if (sameType) score += 10;
  if (Math.abs(a.bbox.y - b.bbox.y) < 80) score += 10;
  if (Math.abs(a.bbox.x - b.bbox.x) < 80) score += 10;
  return score;
}

function bboxOverlapRatio(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeCandidatePreview(text: string): string {
  return String(text || "").replace(/\s+/g, "").slice(0, 120);
}

function notifySidePanel(candidates: QuestionBlock[]) {
  const enriched = candidates.map((block) => ({
    block,
    selected: candidateStatusMap.get(block.id)?.selected ?? false,
    status: (candidateStatusMap.get(block.id)?.status ?? "idle") as "idle" | "loading" | "success" | "error",
  }));
  safeRuntimeSendMessage({ type: "AUTO_DETECT_RESULT_READY", candidates: enriched });
}

