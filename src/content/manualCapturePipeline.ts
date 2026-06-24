import type { AppSettings, HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import type { AnalyticsEvent } from "@/shared/utils/analytics";

type ProviderInfo = {
  name: string;
  baseUrl: string;
  supportsVision: boolean;
};

type FloatingManagerLike = {
  open: (block: QuestionBlock) => void;
  setStreamingText: (text: string) => void;
  setResult: (result: ParseResult) => void;
  setError: (message: string) => void;
};

type ManualCaptureDeps = {
  floatingMgr: FloatingManagerLike;
  resolveQuestionBlockFromBBox: (bbox: QuestionBlock["bbox"]) => {
    refinedBBox: QuestionBlock["bbox"];
    finalBBox: QuestionBlock["bbox"];
    previewText: string;
    matchedCandidate: QuestionBlock | null;
  };
  extractQuestionImageUrlFromBBox: (bbox: QuestionBlock["bbox"]) => string | null;
  screenshotWithRetry: () => Promise<string | null>;
  cropScreenshot: (dataUrl: string, bbox: QuestionBlock["bbox"], scale: number) => Promise<string>;
  loadSettings: () => Promise<AppSettings>;
  getProvider: (providerId: string) => ProviderInfo;
  parseWithTieredRetries: (
    block: QuestionBlock,
    settings: AppSettings,
    providerSupportsVision: boolean,
    onStream: (partial: string) => void,
  ) => Promise<ParseResult>;
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, timeoutReason: string) => Promise<T>;
  addHistoryEntry: (entry: HistoryEntry) => Promise<void>;
  isLikelyIncompleteStem: (result: ParseResult) => boolean;
  shouldPreferVisionResult: (firstResult: ParseResult, visionResult: ParseResult) => boolean;
  shouldForceSecondVisionReview: (block: QuestionBlock, result: ParseResult) => boolean;
  shouldPreferSecondVisionResult: (
    previousResult: ParseResult,
    secondVisionResult: ParseResult,
    block: QuestionBlock,
  ) => boolean;
  logEvent: (event: AnalyticsEvent, payload?: Record<string, unknown>) => void;
};

type ManualCaptureOptions = {
  forceVision: boolean;
  pipelineTimeoutMs: number;
};

export async function runManualCapturePipeline(
  bbox: QuestionBlock["bbox"],
  options: ManualCaptureOptions,
  deps: ManualCaptureDeps,
): Promise<void> {
  const { forceVision, pipelineTimeoutMs } = options;
  const resolved = deps.resolveQuestionBlockFromBBox(bbox);
  const refinedBBox = resolved.refinedBBox;

  deps.logEvent("manual_capture_submitted", {
    bboxW: refinedBBox.width,
    bboxH: refinedBBox.height,
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
      deps.extractQuestionImageUrlFromBBox(finalBBox) ??
      undefined,
    hasImage: forceVision || Boolean(matchedCandidate?.hasImage),
    questionTypeGuess: matchedCandidate?.questionTypeGuess ?? "unknown",
    confidence: Math.max(0.8, matchedCandidate?.confidence ?? 0),
    source: "manual_capture",
  };
  if (block.questionImageUrl) block.hasImage = true;

  deps.floatingMgr.open(block);

  try {
    const dataUrl = await deps.screenshotWithRetry();
    if (dataUrl) {
      deps.logEvent("manual_capture_completed");
      block.imageDataUrl = await deps.cropScreenshot(dataUrl, finalBBox, window.devicePixelRatio);
    } else {
      deps.logEvent("manual_capture_completed", { screenshotFallback: true });
    }

    const settings = await deps.loadSettings();
    const provider = deps.getProvider(settings.providerId ?? "anthropic");
    const hasCapturedImage = Boolean(block.imageDataUrl);
    const forceNonTextRoute =
      provider.supportsVision &&
      hasCapturedImage &&
      settings.preferredRoute === "text";
    const effectiveSettings = forceVision
      ? { ...settings, preferredRoute: "vision" as const }
      : provider.supportsVision && hasCapturedImage
        ? { ...settings, preferredRoute: "vision" as const }
        : forceNonTextRoute
          ? { ...settings, preferredRoute: "auto" as const }
          : settings;

    const finalResult = await deps.withTimeout(
      (async () => {
        const firstPassResult = await deps.parseWithTieredRetries(
          block,
          effectiveSettings,
          provider.supportsVision,
          deps.floatingMgr.setStreamingText.bind(deps.floatingMgr),
        );

        let pickedResult = firstPassResult;
        const shouldRetryWithVision =
          !forceVision &&
          provider.supportsVision &&
          Boolean(block.imageDataUrl) &&
          deps.isLikelyIncompleteStem(firstPassResult);

        if (shouldRetryWithVision) {
          deps.logEvent("manual_auto_vision_retry_started", {
            blockId: block.id,
            initialConfidence: firstPassResult.confidence,
          });
          deps.floatingMgr.setStreamingText("检测到题干可能不完整，正在进行视觉复核...");

          const visionBlock: QuestionBlock = { ...block, hasImage: true };
          const visionSettings = { ...settings, preferredRoute: "vision" as const };
          const visionResult = await deps.parseWithTieredRetries(
            visionBlock,
            visionSettings,
            true,
            deps.floatingMgr.setStreamingText.bind(deps.floatingMgr),
          );

          if (deps.shouldPreferVisionResult(firstPassResult, visionResult)) {
            pickedResult = visionResult;
            deps.logEvent("manual_auto_vision_retry_applied", {
              blockId: block.id,
              beforeConfidence: firstPassResult.confidence,
              afterConfidence: visionResult.confidence,
            });
          } else {
            deps.logEvent("manual_auto_vision_retry_skipped", {
              blockId: block.id,
              beforeConfidence: firstPassResult.confidence,
              afterConfidence: visionResult.confidence,
            });
          }
        }

        const shouldRunSecondVisionReview =
          provider.supportsVision &&
          Boolean(block.imageDataUrl) &&
          deps.shouldForceSecondVisionReview(block, pickedResult);

        if (shouldRunSecondVisionReview) {
          deps.logEvent("manual_second_vision_review_started", {
            blockId: block.id,
            confidence: pickedResult.confidence,
          });
          deps.floatingMgr.setStreamingText("正在进行二次视觉复核，优化分点答案...");
          const secondVisionBlock: QuestionBlock = { ...block, hasImage: true };
          const secondVisionResult = await deps.parseWithTieredRetries(
            secondVisionBlock,
            { ...settings, preferredRoute: "vision" as const },
            true,
            deps.floatingMgr.setStreamingText.bind(deps.floatingMgr),
          );
          if (deps.shouldPreferSecondVisionResult(pickedResult, secondVisionResult, block)) {
            pickedResult = secondVisionResult;
            deps.logEvent("manual_second_vision_review_applied", {
              blockId: block.id,
              beforeConfidence: firstPassResult.confidence,
              afterConfidence: secondVisionResult.confidence,
            });
          } else {
            deps.logEvent("manual_second_vision_review_skipped", {
              blockId: block.id,
              beforeConfidence: firstPassResult.confidence,
              afterConfidence: secondVisionResult.confidence,
            });
          }
        }
        return pickedResult;
      })(),
      pipelineTimeoutMs,
      "manual_pipeline_timeout",
    );

    deps.floatingMgr.setResult(finalResult);
    await deps.addHistoryEntry({
      id: block.id,
      timestamp: Date.now(),
      block,
      result: finalResult,
      host: location.hostname,
    });
    if (finalResult.confidence < 0.5) deps.logEvent("parse_low_confidence", { blockId: block.id });
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err);
    const settings = await deps.loadSettings();
    const provider = deps.getProvider(settings.providerId ?? "anthropic");
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
        deps.floatingMgr.setStreamingText("检测到当前配置与图片题不匹配，正在自动切换视觉解析...");
        const visionResult = await deps.parseWithTieredRetries(
          { ...block, hasImage: true },
          { ...settings, preferredRoute: "vision" as const },
          true,
          deps.floatingMgr.setStreamingText.bind(deps.floatingMgr),
        );
        deps.floatingMgr.setResult(visionResult);
        await deps.addHistoryEntry({
          id: block.id,
          timestamp: Date.now(),
          block,
          result: visionResult,
          host: location.hostname,
        });
        return;
      } catch (visionErr) {
        const visionMsg = visionErr instanceof Error ? visionErr.message : String(visionErr);
        deps.floatingMgr.setError(visionMsg);
        deps.logEvent("parse_error", { error: visionMsg, autoVisionRetry: true });
        return;
      }
    }

    deps.floatingMgr.setError(msg);
    deps.logEvent("parse_error", { error: msg });
  }
}
