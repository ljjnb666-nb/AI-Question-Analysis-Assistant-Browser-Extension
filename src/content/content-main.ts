/**
 * Content Script Main (M1-M6 complete)
 * Adds: keyboard shortcut Alt+Q, streaming, scroll offset, retry, SPA watch
 */

import type { BoundingBox, ExtMessage, QuestionBlock } from "@/shared/types";
import { CaptureOverlay } from "./overlay/CaptureOverlay";
import { FloatingWindowManager } from "./floating/FloatingWindowManager";
import { HighlightLayer } from "./highlight/HighlightLayer";
import { FloatingTrigger } from "./overlay/FloatingTrigger";
import { detectCandidatesInViewport, watchForPageChanges } from "./detector/domDetector";
import { detectCandidatesFullPage, cancelFullPageScan, isFullPageScanRunning } from "./detector/fullPageDetector";
import { cropScreenshot } from "@/shared/utils/cropImage";
import { getProvider, parseQuestion } from "@/shared/utils/parseRouter";
import { loadSettings, addHistoryEntry, pruneIfNeeded } from "@/shared/utils/storage";
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

const floatingMgr = new FloatingWindowManager();
let pendingSubmit = false;
const STREAM_PARSE_TIMEOUT_MS = 20_000;
const MANUAL_PARSE_TIER_TIMEOUTS_MS = [10_000, 20_000, 30_000] as const;
const MANUAL_PARSE_PIPELINE_TIMEOUT_MS = 45_000;

floatingMgr.init();
floatingMgr.setOnRetake(() => startManualCapture(false));
floatingMgr.setOnUpgradeVision(() => {
  logEvent("vision_upgrade_triggered");
  startManualCapture(true);
});

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

function startManualCapture(forceVisionMode: boolean) {
  if (activeOverlay) { activeOverlay.destroy(); activeOverlay = null; }
  highlightLayer?.destroy();
  highlightLayer = null;
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

  // Snap manual selection to the most likely question container to avoid
  // sending navigation/filter regions when users drag a broad rectangle.
  const refinedBBox = refineManualBBoxToQuestionContainer(bbox);

  logEvent("manual_capture_submitted", {
    bboxW: refinedBBox.width, bboxH: refinedBBox.height,
    forceVision,
    scrollY: window.scrollY,
  });

  let previewText = extractTextFromBBox(refinedBBox);
  let finalBBox = refinedBBox;
  if (looksLikeNavigationText(previewText)) {
    const fallbackBBox = findLikelyQuestionBBoxNear(refinedBBox);
    if (fallbackBBox) {
      finalBBox = fallbackBBox;
      previewText = extractTextFromBBox(finalBBox);
    }
  }

  // Align manual-capture pipeline with current-view detector:
  // reuse the best detected card's bbox/text/image/type when overlap is high.
  const matchedCandidate = findBestDetectedCandidateForBBox(finalBBox);
  if (matchedCandidate) {
    finalBBox = matchedCandidate.bbox;
    previewText = matchedCandidate.previewText || previewText;
  }

  const block: QuestionBlock = {
    id: `manual-${Date.now()}`,
    bbox: finalBBox,
    previewText,
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
          floatingMgr.setStreamingText("妫€娴嬪埌棰樺共鍙兘涓嶅畬鏁达紝姝ｅ湪杩涜瑙嗚澶嶆牳...");

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
        floatingMgr.setStreamingText("妫€娴嬪埌褰撳墠閰嶇疆涓庡浘鐗囬涓嶅尮閰嶏紝姝ｅ湪鑷姩鍒囨崲瑙嗚瑙ｆ瀽...");
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
  return /(缂哄け棰樺共|棰樼洰涓嶅畬鏁磡閫夐」缂哄け|鏃犳硶浣滅瓟|鏃犳硶鍒ゆ柇|鏃犳硶纭畾|missing stem|incomplete question|missing options|insufficient options)/i.test(warningText);
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
  const selector = "h1,h2,h3,h4,p,li,td,label,span,div";
  const nodes = Array.from(container.querySelectorAll(selector));
  const entries: Array<{ top: number; left: number; text: string }> = [];

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (isExtensionUiElement(node)) continue;
    if (!isElementVisible(node)) continue;
    const rect = node.getBoundingClientRect();
    const interArea = intersectionArea(rect, bbox);
    if (interArea < 8) continue;
    if (rect.width < 2 || rect.height < 2) continue;

    const text = normalizeQuestionText(node.innerText || node.textContent || "");
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
      isElementVisible(parent)
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
  const selector = "h1,h2,h3,h4,p,li,td,label,span";
  const nodes = Array.from(document.querySelectorAll(selector));
  const entries: Array<{ top: number; left: number; text: string }> = [];

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (isExtensionUiElement(node)) continue;
    if (node.offsetParent === null) continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") continue;

    const rect = node.getBoundingClientRect();
    if (!rectIntersectsBBox(rect, bbox)) continue;
    if (rect.width < 2 || rect.height < 2) continue;

    const text = normalizeQuestionText(node.innerText || node.textContent || "");
    if (!text) continue;
    if (text.length > 220) continue; // skip large container-like nodes

    entries.push({ top: rect.top, left: rect.left, text });
  }

  return mergeTextEntries(entries).slice(0, 1200);
}

function normalizeInlineText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
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
  return stripLikelyTrailingCodeOrJson(cleaned);
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

  // Notify sidepanel scan started with 0%
  chrome.runtime.sendMessage({
    type: "FULL_PAGE_DETECT_PROGRESS",
    progress: 0,
    found: 0,
    currentStep: 0,
    totalScrollSteps: 1,
  });

  try {
    const candidates = await detectCandidatesFullPage((p) => {
      chrome.runtime.sendMessage({
        type: "FULL_PAGE_DETECT_PROGRESS",
        progress: p.progress,
        found: p.found,
        currentStep: p.currentStep,
        totalScrollSteps: p.totalScrollSteps,
      });
    });

    logEvent("auto_detect_candidates_found", { count: candidates.length, mode: "full_page" });

    // Convert absolute coords back to viewport-relative for highlighting
    const viewportRelative = candidates.map(b => ({
      ...b,
      bbox: {
        x: b.bbox.x - window.scrollX,
        y: b.bbox.y - window.scrollY,
        width: b.bbox.width,
        height: b.bbox.height,
      },
    }));
    activeCandidates = candidates;
    activeHighlightBlocks = viewportRelative;

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

    chrome.runtime.sendMessage({
      type: "FULL_PAGE_DETECT_DONE",
      candidates,
      totalFound: candidates.length,
    });

  } catch (err) {
    console.error("[QS] Full page detect error:", err);
    activeCandidates = [];
    activeHighlightBlocks = [];
    chrome.runtime.sendMessage({
      type: "FULL_PAGE_DETECT_DONE",
      candidates: [],
      totalFound: 0,
    });
  }
}

// 鈹€鈹€鈹€ Auto Detect 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function handleAutoDetect() {
  logEvent("auto_detect_started");
  highlightLayer?.destroy();
  unwatchSPA?.();
  candidateStatusMap.clear();
  activeCandidates = [];
  activeHighlightBlocks = [];

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

function notifySidePanel(candidates: QuestionBlock[]) {
  const enriched = candidates.map(b => ({
    ...b,
    _selected: candidateStatusMap.get(b.id)?.selected ?? false,
    _status: candidateStatusMap.get(b.id)?.status ?? "pending",
  }));
  chrome.runtime.sendMessage({ type: "AUTO_DETECT_RESULT_READY", candidates: enriched });
}

