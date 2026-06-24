import type { AppSettings, HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import type { AnalyticsEvent } from "@/shared/utils/analytics";
import { CaptureOverlay } from "./overlay/CaptureOverlay";
import { runManualCapturePipeline } from "./manualCapturePipeline";

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

type ManualCapturePipelineDeps = {
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

type ManualCaptureStartDeps = {
  activeOverlay: CaptureOverlay | null;
  clearHighlightLayer: () => void;
  logEvent: (event: AnalyticsEvent, payload?: Record<string, unknown>) => void;
  onSubmit: (bbox: QuestionBlock["bbox"], forceVision: boolean) => void;
  refreshLayoutResizeObservation: () => void;
  resetDetectMode: () => void;
  setActiveOverlay: (overlay: CaptureOverlay | null) => void;
};

type ManualCaptureSubmitDeps = {
  forceVision: boolean;
  isPendingSubmit: () => boolean;
  pipelineDeps: ManualCapturePipelineDeps;
  pipelineTimeoutMs: number;
  setActiveOverlay: (overlay: CaptureOverlay | null) => void;
  setPendingSubmit: (pending: boolean) => void;
};

export function startManualCaptureSession(forceVisionMode: boolean, deps: ManualCaptureStartDeps): void {
  if (deps.activeOverlay) {
    deps.activeOverlay.destroy();
    deps.setActiveOverlay(null);
  }

  deps.clearHighlightLayer();
  deps.resetDetectMode();
  deps.refreshLayoutResizeObservation();
  deps.logEvent("manual_capture_started");

  deps.setActiveOverlay(new CaptureOverlay({
    onSubmit: (bbox, forceVision) => deps.onSubmit(bbox, forceVisionMode || forceVision),
    onCancel: () => {
      deps.setActiveOverlay(null);
      deps.logEvent("manual_capture_cancelled");
    },
  }));
}

export async function submitManualCapture(
  bbox: QuestionBlock["bbox"],
  deps: ManualCaptureSubmitDeps,
): Promise<void> {
  deps.setActiveOverlay(null);
  if (deps.isPendingSubmit()) return;
  deps.setPendingSubmit(true);

  try {
    await runManualCapturePipeline(
      bbox,
      {
        forceVision: deps.forceVision,
        pipelineTimeoutMs: deps.pipelineTimeoutMs,
      },
      deps.pipelineDeps,
    );
  } finally {
    deps.setPendingSubmit(false);
  }
}
