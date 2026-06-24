import type { AppSettings, DetectedCandidate, HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";

type UpdateCandidates = (
  updater: (prev: DetectedCandidate[]) => DetectedCandidate[],
) => void;

type ParseDeps = {
  loadSettings: () => Promise<AppSettings>;
  getProvider: (providerId: string) => { supportsVision: boolean };
  parseQuestion: (block: QuestionBlock, settings: AppSettings) => Promise<ParseResult>;
  requestBlockImage: (tabId: number, bbox: QuestionBlock["bbox"]) => Promise<string | null>;
  addHistoryEntry: (entry: HistoryEntry) => Promise<void>;
  pickBatchReviewModel: (providerId: string, currentModel: string) => string;
  shouldRetryBatchParseAfterError: (err: unknown) => boolean;
  shouldRetryWithVision: (result: ParseResult) => boolean;
  preferVisionResult: (textResult: ParseResult, visionResult: ParseResult) => boolean;
  hasSufficientPreviewText: (text: string) => boolean;
  langSafe: (lang: "zh" | "en" | undefined, zh: string, en: string) => string;
  shouldRetryBatchParseForIncompleteResult: (result: ParseResult, block: QuestionBlock) => boolean;
  preferBatchRetryResult: (firstResult: ParseResult, retryResult: ParseResult, block: QuestionBlock) => boolean;
  setCandidates: UpdateCandidates;
};

type VisionRetryDeps = {
  loadSettings: () => Promise<AppSettings>;
  getProvider: (providerId: string) => { supportsVision: boolean };
  requestBlockImage: (tabId: number, bbox: QuestionBlock["bbox"]) => Promise<string | null>;
  parseQuestion: (block: QuestionBlock, settings: AppSettings) => Promise<ParseResult>;
  addHistoryEntry: (entry: HistoryEntry) => Promise<void>;
  setCandidates: UpdateCandidates;
  langSafe: (lang: "zh" | "en" | undefined, zh: string, en: string) => string;
};

type FillDeps = {
  getBestActionTab: () => Promise<chrome.tabs.Tab | null>;
  sendFillMessageWithVerify: (
    tabId: number,
    block: QuestionBlock,
    result: ParseResult,
  ) => Promise<{ ok?: boolean; filledCount?: number; message?: string } | null>;
};

export function selectRiskyCandidates(
  candidates: DetectedCandidate[],
  isRiskyCandidate: (candidate: DetectedCandidate) => boolean,
): {
  next: DetectedCandidate[];
  selectedIds: Set<string>;
} {
  const next = candidates.map((cand) => ({ ...cand, selected: isRiskyCandidate(cand) }));
  const selectedIds = new Set(next.filter((cand) => cand.selected).map((cand) => cand.block.id));
  return { next, selectedIds };
}

export async function runBatchParse(
  candidates: DetectedCandidate[],
  activeTab: chrome.tabs.Tab | null,
  deps: ParseDeps,
): Promise<void> {
  const selected = candidates.filter((c) => c.selected);
  if (!selected.length) return;

  const settings = await deps.loadSettings();
  let sourceHost: string;
  try {
    sourceHost = activeTab?.url ? new URL(activeTab.url).hostname : "";
  } catch {
    sourceHost = "";
  }

  for (const cand of selected) {
    deps.setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "loading" as const } : c)));
    try {
      const provider = deps.getProvider(settings.providerId ?? "anthropic");
      let firstPassBlock: QuestionBlock = cand.block;
      let imageAttached = false;
      if (activeTab?.id) {
        const firstPassImage = await deps.requestBlockImage(activeTab.id, cand.block.bbox);
        if (firstPassImage) {
          firstPassBlock = { ...cand.block, hasImage: true, imageDataUrl: firstPassImage };
          imageAttached = true;
        }
      }
      const firstPassRoute =
        provider.supportsVision
          ? (firstPassBlock.imageDataUrl ? "vision" as const : "auto" as const)
          : ("text" as const);
      const firstPassSettings = { ...settings, preferredRoute: firstPassRoute };
      const retrySettings = {
        ...settings,
        apiModel: deps.pickBatchReviewModel(settings.providerId ?? "anthropic", settings.apiModel),
        preferredRoute: firstPassRoute,
      };

      let historyBlock: QuestionBlock = firstPassBlock;
      let result: ParseResult;
      try {
        result = await deps.parseQuestion(firstPassBlock, firstPassSettings);
      } catch (firstErr) {
        if (!deps.shouldRetryBatchParseAfterError(firstErr)) throw firstErr;
        result = await deps.parseQuestion(firstPassBlock, retrySettings);
      }
      const needVisionRetry =
        provider.supportsVision &&
        !firstPassBlock.imageDataUrl &&
        deps.shouldRetryWithVision(result) &&
        !!activeTab?.id;

      if (needVisionRetry) {
        const imageDataUrl = await deps.requestBlockImage(activeTab!.id!, cand.block.bbox);
        if (imageDataUrl) {
          const visionBlock: QuestionBlock = { ...cand.block, hasImage: true, imageDataUrl };
          const visionSettings = { ...settings, preferredRoute: "vision" as const };
          const visionResult = await deps.parseQuestion(visionBlock, visionSettings);
          if (deps.preferVisionResult(result, visionResult)) {
            result = visionResult;
            historyBlock = visionBlock;
            imageAttached = true;
          }
        } else if (cand.block.hasImage && !deps.hasSufficientPreviewText(cand.block.previewText)) {
          throw new Error(deps.langSafe(settings.language, "图片题截图失败，请重试滚动后重试", "Image capture failed for image question. Please retry after scrolling."));
        }
      }

      if (deps.shouldRetryBatchParseForIncompleteResult(result, cand.block)) {
        const reviewedResult = await deps.parseQuestion(historyBlock, retrySettings);
        if (deps.preferBatchRetryResult(result, reviewedResult, cand.block)) {
          result = reviewedResult;
        }
      }

      deps.setCandidates((prev) =>
        prev.map((c) =>
          c.block.id === cand.block.id
            ? { ...c, status: "success" as const, result, debugInfo: { imageAttached, routeUsed: result.routeUsed } }
            : c,
        ),
      );
      await deps.addHistoryEntry({ id: cand.block.id, timestamp: Date.now(), block: historyBlock, result, host: sourceHost });
    } catch (err) {
      deps.setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "error" as const, error: String(err) } : c)));
    }
  }
}

export async function runRetryVision(
  cand: DetectedCandidate,
  activeTab: chrome.tabs.Tab | null,
  deps: VisionRetryDeps,
): Promise<void> {
  const settings = await deps.loadSettings();
  const provider = deps.getProvider(settings.providerId ?? "anthropic");
  if (!provider.supportsVision || !activeTab?.id) return;

  deps.setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "loading" as const } : c)));
  try {
    const imageDataUrl = await deps.requestBlockImage(activeTab.id, cand.block.bbox);
    if (!imageDataUrl) throw new Error(deps.langSafe(settings.language, "截图失败", "Image capture failed"));
    const visionBlock: QuestionBlock = { ...cand.block, hasImage: true, imageDataUrl };
    const visionResult = await deps.parseQuestion(visionBlock, { ...settings, preferredRoute: "vision" as const });
    deps.setCandidates((prev) =>
      prev.map((c) =>
        c.block.id === cand.block.id
          ? { ...c, status: "success" as const, result: visionResult, debugInfo: { imageAttached: true, routeUsed: visionResult.routeUsed } }
          : c,
      ),
    );
    await deps.addHistoryEntry({ id: cand.block.id, timestamp: Date.now(), block: visionBlock, result: visionResult, host: location.hostname });
  } catch (err) {
    deps.setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "error" as const, error: String(err) } : c)));
  }
}

export async function runRetryRisky(
  candidates: DetectedCandidate[],
  activeTab: chrome.tabs.Tab | null,
  isRiskyCandidate: (candidate: DetectedCandidate) => boolean,
  deps: VisionRetryDeps,
): Promise<void> {
  const settings = await deps.loadSettings();
  const provider = deps.getProvider(settings.providerId ?? "anthropic");
  if (!provider.supportsVision || !activeTab?.id) return;

  const riskyCandidates = candidates.filter(isRiskyCandidate);
  if (!riskyCandidates.length) return;

  for (const cand of riskyCandidates) {
    deps.setCandidates((prev) => prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "loading" as const } : c)));
    try {
      const imageDataUrl = await deps.requestBlockImage(activeTab.id, cand.block.bbox);
      if (!imageDataUrl) throw new Error(deps.langSafe(settings.language, "截图失败", "Image capture failed"));
      const visionBlock: QuestionBlock = { ...cand.block, hasImage: true, imageDataUrl };
      const visionResult = await deps.parseQuestion(visionBlock, { ...settings, preferredRoute: "vision" as const });
      deps.setCandidates((prev) =>
        prev.map((c) =>
          c.block.id === cand.block.id
            ? { ...c, status: "success" as const, result: visionResult, error: undefined, debugInfo: { imageAttached: true, routeUsed: visionResult.routeUsed } }
            : c,
        ),
      );
      await deps.addHistoryEntry({ id: cand.block.id, timestamp: Date.now(), block: visionBlock, result: visionResult, host: location.hostname });
    } catch (err) {
      deps.setCandidates((prev) =>
        prev.map((c) => (c.block.id === cand.block.id ? { ...c, status: "error" as const, error: String(err) } : c)),
      );
    }
  }
}

export async function runFillCandidate(
  cand: DetectedCandidate,
  deps: FillDeps,
): Promise<{ ok?: boolean; filledCount?: number; message?: string } | null> {
  if (!cand.result) return null;
  const activeTab = await deps.getBestActionTab();
  if (!activeTab?.id) return null;
  return deps.sendFillMessageWithVerify(activeTab.id, cand.block, cand.result);
}

export async function runBatchFill(
  candidates: DetectedCandidate[],
  deps: FillDeps,
): Promise<{ totalFilled: number; totalQuestions: number }> {
  const targets = candidates.filter((cand) => cand.selected && cand.status === "success" && cand.result);
  if (!targets.length) return { totalFilled: 0, totalQuestions: 0 };

  const activeTab = await deps.getBestActionTab();
  if (!activeTab?.id) return { totalFilled: 0, totalQuestions: 0 };

  let totalFilled = 0;
  for (const cand of targets) {
    const resp = await deps.sendFillMessageWithVerify(activeTab.id, cand.block, cand.result!);
    totalFilled += resp?.filledCount ?? 0;
  }
  return { totalFilled, totalQuestions: targets.length };
}
