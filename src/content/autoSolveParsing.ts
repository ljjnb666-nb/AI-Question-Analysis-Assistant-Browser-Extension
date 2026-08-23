import type { AppSettings, HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import type { ParseQuestionRuntimeContext } from "@/shared/utils/parseRouter";
import {
  buildAutoSolveReviewSettings,
  pickAutoSolveReviewModel,
  shouldRetryWithVisionForAuto,
  shouldUseVisionForAutoSolve,
} from "./autoSolveHeuristics";

type ProviderInfo = {
  supportsVision: boolean;
};

type AutoSolveParsingDeps = {
  loadSettings: () => Promise<AppSettings>;
  getProvider: (providerId: string) => ProviderInfo;
  tryCaptureBlockImageForAutoSolve: (bbox: QuestionBlock["bbox"]) => Promise<string | null>;
  parseWithTieredRetries: (
    block: QuestionBlock,
    settings: AppSettings,
    providerSupportsVision: boolean,
    onStream: (partial: string) => void,
    runtimeContext?: ParseQuestionRuntimeContext,
  ) => Promise<ParseResult>;
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, timeoutReason: string) => Promise<T>;
  parseQuestion: (block: QuestionBlock, settings: AppSettings, onStream?: (partial: string) => void, runtimeContext?: ParseQuestionRuntimeContext) => Promise<ParseResult>;
  addHistoryEntry: (entry: HistoryEntry) => Promise<void>;
};

type AutoSolveTimeouts = {
  parseTimeoutMs: number;
  reviewTimeoutMs: number;
  quickReviewTimeoutMs: number;
  reviewConfidenceThreshold: number;
};

async function attachVisionImageIfAvailable(
  block: QuestionBlock,
  supportsVision: boolean,
  tryCaptureBlockImageForAutoSolve: AutoSolveParsingDeps["tryCaptureBlockImageForAutoSolve"],
): Promise<QuestionBlock> {
  if (!supportsVision) return block;
  const imageDataUrl = await tryCaptureBlockImageForAutoSolve(block.bbox);
  if (!imageDataUrl) return block;
  return { ...block, hasImage: true, imageDataUrl };
}

async function maybeAttachVisionImage(
  block: QuestionBlock,
  shouldAttach: boolean,
  supportsVision: boolean,
  tryCaptureBlockImageForAutoSolve: AutoSolveParsingDeps["tryCaptureBlockImageForAutoSolve"],
): Promise<QuestionBlock> {
  if (!shouldAttach) return block;
  return attachVisionImageIfAvailable(block, supportsVision, tryCaptureBlockImageForAutoSolve);
}

export async function parseBlockForAutoSolve(
  block: QuestionBlock,
  timeouts: AutoSolveTimeouts,
  deps: AutoSolveParsingDeps,
  runtimeContext?: ParseQuestionRuntimeContext,
): Promise<ParseResult> {
  const settings = await deps.loadSettings();
  const provider = deps.getProvider(settings.providerId ?? "anthropic");
  const wantsVision = provider.supportsVision && shouldUseVisionForAutoSolve(block, settings.preferredRoute);
  let parseBlock = await maybeAttachVisionImage(
    block,
    wantsVision,
    provider.supportsVision,
    deps.tryCaptureBlockImageForAutoSolve,
  );

  const firstPassSettings = wantsVision && parseBlock.imageDataUrl
    ? { ...settings, preferredRoute: "vision" as const }
    : { ...settings, preferredRoute: "auto" as const };

  let result = await deps.withTimeout(
    deps.parseWithTieredRetries(parseBlock, firstPassSettings, provider.supportsVision, () => {}, withScreenshotFallback(parseBlock, runtimeContext)),
    timeouts.parseTimeoutMs,
    "auto_solve_parse_timeout",
  );

  if (provider.supportsVision && shouldRetryWithVisionForAuto(result, block)) {
    const imageDataUrl = parseBlock.imageDataUrl || await deps.tryCaptureBlockImageForAutoSolve(block.bbox);
    if (imageDataUrl) {
      parseBlock = { ...block, hasImage: true, imageDataUrl };
      result = await deps.withTimeout(
        deps.parseWithTieredRetries(
          parseBlock,
          { ...settings, preferredRoute: "vision" as const },
          provider.supportsVision,
          () => {}, withScreenshotFallback(parseBlock, runtimeContext),
        ),
        timeouts.parseTimeoutMs,
        "auto_solve_vision_retry_timeout",
      );
    }
  }

  return result;
}

export async function parseBlockForAutoSolveReview(
  block: QuestionBlock,
  previousResult: ParseResult | null,
  timeouts: AutoSolveTimeouts,
  deps: AutoSolveParsingDeps,
  runtimeContext?: ParseQuestionRuntimeContext,
): Promise<ParseResult> {
  const settings = await deps.loadSettings();
  const provider = deps.getProvider(settings.providerId ?? "anthropic");
  const reviewSettings = buildAutoSolveReviewSettings(settings);
  const shouldAttachForReview =
    provider.supportsVision && shouldUseVisionForAutoSolve(block, reviewSettings.preferredRoute);
  const parseBlock = await maybeAttachVisionImage(
    block,
    shouldAttachForReview,
    provider.supportsVision,
    deps.tryCaptureBlockImageForAutoSolve,
  );

  let result = await deps.withTimeout(
    deps.parseWithTieredRetries(parseBlock, reviewSettings, provider.supportsVision, () => {}, withScreenshotFallback(parseBlock, runtimeContext)),
    timeouts.reviewTimeoutMs,
    "auto_solve_review_timeout",
  );

  if (
    provider.supportsVision &&
    parseBlock.imageDataUrl &&
    (shouldRetryWithVisionForAuto(result, block)
      || (previousResult && (result.confidence ?? 0) < Math.max(previousResult.confidence ?? 0, timeouts.reviewConfidenceThreshold)))
  ) {
    result = await deps.withTimeout(
      deps.parseWithTieredRetries(
        { ...block, hasImage: true, imageDataUrl: parseBlock.imageDataUrl },
        { ...reviewSettings, preferredRoute: "vision" as const },
        provider.supportsVision,
        () => {}, withScreenshotFallback(parseBlock, runtimeContext),
      ),
      timeouts.reviewTimeoutMs,
      "auto_solve_review_vision_timeout",
    );
  }

  return result;
}

export async function parseBlockForAutoSolveQuickReview(
  block: QuestionBlock,
  timeouts: AutoSolveTimeouts,
  deps: AutoSolveParsingDeps,
  runtimeContext?: ParseQuestionRuntimeContext,
): Promise<ParseResult> {
  const settings = await deps.loadSettings();
  const provider = deps.getProvider(settings.providerId ?? "anthropic");
  const quickReviewSettings = {
    ...settings,
    apiModel: pickAutoSolveReviewModel(settings.providerId, settings.apiModel),
    preferredRoute: "auto" as const,
  };
  const shouldAttachForQuickReview =
    provider.supportsVision && shouldUseVisionForAutoSolve(block, quickReviewSettings.preferredRoute);
  const parseBlock = await maybeAttachVisionImage(
    block,
    shouldAttachForQuickReview,
    provider.supportsVision,
    deps.tryCaptureBlockImageForAutoSolve,
  );

  return deps.withTimeout(
    deps.parseQuestion(parseBlock, quickReviewSettings, undefined, withScreenshotFallback(parseBlock, runtimeContext)),
    timeouts.quickReviewTimeoutMs,
    "auto_solve_quick_review_timeout",
  );
}

function withScreenshotFallback(block: QuestionBlock, runtimeContext?: ParseQuestionRuntimeContext): ParseQuestionRuntimeContext | undefined {
  if (!runtimeContext) return undefined;
  const questionId = block.identity?.stableId ?? block.id;
  const contentFingerprint = block.identity?.contentFingerprint ?? block.id;
  return block.imageDataUrl
    ? { ...runtimeContext, screenshotFallback: { dataUrl: block.imageDataUrl, questionId, contentFingerprint } }
    : runtimeContext;
}

export function shouldReviewLowConfidenceHistory(
  entry: HistoryEntry | null,
  reviewConfidenceThreshold: number,
): boolean {
  if (!entry) return false;
  return (entry.result.confidence ?? 0) < reviewConfidenceThreshold;
}

export async function recordAutoSolveHistory(
  history: HistoryEntry[],
  block: QuestionBlock,
  result: ParseResult,
  deps: Pick<AutoSolveParsingDeps, "addHistoryEntry">,
): Promise<void> {
  const historyId = `auto-solve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: HistoryEntry = {
    id: historyId,
    timestamp: Date.now(),
    block: { ...block, imageDataUrl: undefined },
    result,
    host: location.hostname,
  };
  await deps.addHistoryEntry(entry);
  history.unshift(entry);
}
