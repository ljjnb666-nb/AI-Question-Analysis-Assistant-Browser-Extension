import type { AppSettings, CandidateOrigin, DetectedCandidate, HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import type { FillAnswerCode } from "@/content/answerTypes";
import type { CandidateAttemptLease, CandidateAttemptRegistry } from "./candidateAuthority";
import { candidateMatchesBlockAndOrigin } from "./candidateAuthority";

type UpdateCandidates = (updater: (prev: DetectedCandidate[]) => DetectedCandidate[]) => void;
type IsCandidateCurrent = (candidate: DetectedCandidate) => Promise<boolean>;
type AddHistoryEntryIfCurrent = (entry: HistoryEntry, isCurrent: () => Promise<boolean>) => Promise<boolean>;

type AttemptDeps = {
  attempts: CandidateAttemptRegistry;
  isCandidateCurrent: IsCandidateCurrent;
  addHistoryEntryIfCurrent: AddHistoryEntryIfCurrent;
  logCommittedResult: (candidate: DetectedCandidate, result: ParseResult) => void;
  logDiscardedStaleResult: (candidate: DetectedCandidate, result: ParseResult) => void;
  setCandidates: UpdateCandidates;
};

type ParseDeps = AttemptDeps & {
  loadSettings: () => Promise<AppSettings>;
  getProvider: (providerId: string) => { supportsVision: boolean };
  parseQuestion: (block: QuestionBlock, settings: AppSettings) => Promise<ParseResult>;
  requestBlockImage: (tabId: number, bbox: QuestionBlock["bbox"]) => Promise<string | null>;
  pickBatchReviewModel: (providerId: string, currentModel: string) => string;
  shouldRetryBatchParseAfterError: (err: unknown) => boolean;
  shouldRetryWithVision: (result: ParseResult) => boolean;
  preferVisionResult: (textResult: ParseResult, visionResult: ParseResult) => boolean;
  hasSufficientPreviewText: (text: string) => boolean;
  langSafe: (lang: "zh" | "en" | undefined, zh: string, en: string) => string;
  shouldRetryBatchParseForIncompleteResult: (result: ParseResult, block: QuestionBlock) => boolean;
  preferBatchRetryResult: (firstResult: ParseResult, retryResult: ParseResult, block: QuestionBlock) => boolean;
};

type VisionRetryDeps = AttemptDeps & {
  loadSettings: () => Promise<AppSettings>;
  getProvider: (providerId: string) => { supportsVision: boolean };
  requestBlockImage: (tabId: number, bbox: QuestionBlock["bbox"]) => Promise<string | null>;
  parseQuestion: (block: QuestionBlock, settings: AppSettings) => Promise<ParseResult>;
  langSafe: (lang: "zh" | "en" | undefined, zh: string, en: string) => string;
  pickBatchReviewModel: (providerId: string, currentModel: string) => string;
  shouldRetryBatchParseForIncompleteResult: (result: ParseResult, block: QuestionBlock) => boolean;
  preferBatchRetryResult: (firstResult: ParseResult, retryResult: ParseResult, block: QuestionBlock) => boolean;
};

type FillDeps = {
  isCandidateCurrent: IsCandidateCurrent;
  setCandidates: UpdateCandidates;
  sendFillMessageWithVerify: (
    tabId: number,
    block: QuestionBlock,
    result: ParseResult,
    expectedUrl: string,
  ) => Promise<{ ok?: boolean; filledCount?: number; message?: string; code?: FillAnswerCode } | null>;
};

const STALE_CANDIDATE_RESULT = "STALE_QUESTION_REVISION";

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

export async function runBatchParse(candidates: DetectedCandidate[], deps: ParseDeps): Promise<void> {
  const selected = candidates.filter((candidate) => candidate.selected);
  if (!selected.length) return;

  const settings = await deps.loadSettings();
  for (const candidate of selected) {
    const lease = deps.attempts.begin(candidate);
    if (!lease) {
      clearStaleCandidate(candidate, deps, null);
      continue;
    }
    try {
      if (!await isAuthorized(candidate, lease, deps)) {
        clearStaleCandidate(candidate, deps, lease);
        continue;
      }
      setCandidateLoading(candidate, lease, deps);

      const provider = deps.getProvider(settings.providerId ?? "anthropic");
      let firstPassBlock: QuestionBlock = candidate.block;
      let imageAttached = false;
      const originTabId = candidate.origin?.tabId;
      if (provider.supportsVision && originTabId) {
        const firstPassImage = await deps.requestBlockImage(originTabId, candidate.block.bbox);
        if (!await isAuthorized(candidate, lease, deps)) {
          clearStaleCandidate(candidate, deps, lease);
          continue;
        }
        if (firstPassImage) {
          firstPassBlock = { ...candidate.block, hasImage: true, imageDataUrl: firstPassImage };
          imageAttached = true;
        }
      }
      const firstPassRoute = provider.supportsVision
        ? firstPassBlock.imageDataUrl ? "vision" as const : "auto" as const
        : "text" as const;
      const firstPassSettings = { ...settings, preferredRoute: firstPassRoute };
      const retrySettings = {
        ...settings,
        apiModel: deps.pickBatchReviewModel(settings.providerId ?? "anthropic", settings.apiModel),
        preferredRoute: firstPassRoute,
      };

      let historyBlock = firstPassBlock;
      let result: ParseResult;
      try {
        result = await deps.parseQuestion(firstPassBlock, firstPassSettings);
      } catch (firstError) {
        if (!await isAuthorized(candidate, lease, deps)) {
          clearStaleCandidate(candidate, deps, lease);
          continue;
        }
        if (!deps.shouldRetryBatchParseAfterError(firstError)) throw firstError;
        result = await deps.parseQuestion(firstPassBlock, retrySettings);
      }
      if (!await isAuthorized(candidate, lease, deps)) {
        discardStaleProviderResult(candidate, lease, result, deps);
        continue;
      }

      const needVisionRetry = provider.supportsVision
        && !firstPassBlock.imageDataUrl
        && deps.shouldRetryWithVision(result)
        && Boolean(originTabId);
      if (needVisionRetry && originTabId) {
        const imageDataUrl = await deps.requestBlockImage(originTabId, candidate.block.bbox);
        if (!await isAuthorized(candidate, lease, deps)) {
          clearStaleCandidate(candidate, deps, lease);
          continue;
        }
        if (imageDataUrl) {
          const visionBlock: QuestionBlock = { ...candidate.block, hasImage: true, imageDataUrl };
          const visionResult = await deps.parseQuestion(visionBlock, { ...settings, preferredRoute: "vision" as const });
          if (!await isAuthorized(candidate, lease, deps)) {
            discardStaleProviderResult(candidate, lease, visionResult, deps);
            continue;
          }
          if (deps.preferVisionResult(result, visionResult)) {
            result = visionResult;
            historyBlock = visionBlock;
            imageAttached = true;
          }
        } else if (candidate.block.hasImage && !deps.hasSufficientPreviewText(candidate.block.previewText)) {
          throw new Error(deps.langSafe(settings.language, "图片题截图失败，请重试滚动后重试", "Image capture failed for image question. Please retry after scrolling."));
        }
      }

      if (deps.shouldRetryBatchParseForIncompleteResult(result, candidate.block)) {
        if (!await isAuthorized(candidate, lease, deps)) {
          clearStaleCandidate(candidate, deps, lease);
          continue;
        }
        const reviewedResult = await deps.parseQuestion(historyBlock, retrySettings);
        if (!await isAuthorized(candidate, lease, deps)) {
          discardStaleProviderResult(candidate, lease, reviewedResult, deps);
          continue;
        }
        if (deps.preferBatchRetryResult(result, reviewedResult, candidate.block)) result = reviewedResult;
      }

      await commitCandidateResult(candidate, lease, historyBlock, result, {
        imageAttached,
        routeUsed: result.routeUsed,
      }, deps);
    } catch (error) {
      await recoverCandidateAfterError(candidate, lease, error, deps);
    }
  }
}

export async function runRetryVision(cand: DetectedCandidate, deps: VisionRetryDeps): Promise<void> {
  await runVisionRetryForCandidate(cand, deps);
}

export async function runRetryRisky(
  candidates: DetectedCandidate[],
  isRiskyCandidate: (candidate: DetectedCandidate) => boolean,
  deps: VisionRetryDeps,
): Promise<void> {
  for (const candidate of candidates.filter(isRiskyCandidate)) {
    await runVisionRetryForCandidate(candidate, deps);
  }
}

async function runVisionRetryForCandidate(candidate: DetectedCandidate, deps: VisionRetryDeps): Promise<void> {
  const lease = deps.attempts.begin(candidate);
  if (!lease) {
    clearStaleCandidate(candidate, deps, null);
    return;
  }
  try {
    if (!await isAuthorized(candidate, lease, deps)) {
      clearStaleCandidate(candidate, deps, lease);
      return;
    }
    setCandidateLoading(candidate, lease, deps);
    const settings = await deps.loadSettings();
    const provider = deps.getProvider(settings.providerId ?? "anthropic");
    const originTabId = candidate.origin?.tabId;
    if (!provider.supportsVision || !originTabId) {
      clearStaleCandidate(candidate, deps, lease);
      return;
    }

    const imageDataUrl = await deps.requestBlockImage(originTabId, candidate.block.bbox);
    if (!await isAuthorized(candidate, lease, deps)) {
      clearStaleCandidate(candidate, deps, lease);
      return;
    }
    if (!imageDataUrl) throw new Error(deps.langSafe(settings.language, "截图失败", "Image capture failed"));
    const visionBlock: QuestionBlock = { ...candidate.block, hasImage: true, imageDataUrl };
    const visionSettings = { ...settings, preferredRoute: "vision" as const };
    const reviewSettings = {
      ...visionSettings,
      apiModel: deps.pickBatchReviewModel(settings.providerId ?? "anthropic", settings.apiModel),
    };

    let finalResult = await deps.parseQuestion(visionBlock, visionSettings);
    if (!await isAuthorized(candidate, lease, deps)) {
      discardStaleProviderResult(candidate, lease, finalResult, deps);
      return;
    }
    if (deps.shouldRetryBatchParseForIncompleteResult(finalResult, candidate.block)) {
      const reviewedResult = await deps.parseQuestion(visionBlock, reviewSettings);
      if (!await isAuthorized(candidate, lease, deps)) {
        discardStaleProviderResult(candidate, lease, reviewedResult, deps);
        return;
      }
      if (deps.preferBatchRetryResult(finalResult, reviewedResult, candidate.block)) finalResult = reviewedResult;
    }

    const resultToKeep = candidate.status === "success"
      && candidate.result
      && !deps.preferBatchRetryResult(candidate.result, finalResult, candidate.block)
      ? candidate.result
      : finalResult;
    await commitCandidateResult(candidate, lease, visionBlock, resultToKeep, {
      imageAttached: true,
      routeUsed: resultToKeep.routeUsed,
    }, deps);
  } catch (error) {
    await recoverCandidateAfterError(candidate, lease, error, deps);
  }
}

export async function runFillCandidate(
  candidate: DetectedCandidate,
  deps: FillDeps,
): Promise<{ ok?: boolean; filledCount?: number; message?: string; code?: FillAnswerCode } | null> {
  if (!candidate.result) return null;
  if (!candidate.origin?.tabId || !candidate.origin.url || !await deps.isCandidateCurrent(candidate)) {
    clearFilledCandidateResult(candidate, deps.setCandidates);
    return { ok: false, filledCount: 0, code: "STALE_QUESTION_REVISION", message: STALE_CANDIDATE_RESULT };
  }
  const response = await deps.sendFillMessageWithVerify(candidate.origin.tabId, candidate.block, candidate.result, candidate.origin.url);
  if (!await deps.isCandidateCurrent(candidate)) clearFilledCandidateResult(candidate, deps.setCandidates);
  return response;
}

export async function runBatchFill(
  candidates: DetectedCandidate[],
  deps: FillDeps,
): Promise<{ totalFilled: number; totalQuestions: number }> {
  const targets = candidates.filter((candidate) => candidate.selected && candidate.status === "success" && candidate.result);
  let totalFilled = 0;
  let totalQuestions = 0;
  for (const candidate of targets) {
    if (!candidate.origin?.tabId || !candidate.origin.url || !await deps.isCandidateCurrent(candidate)) {
      clearFilledCandidateResult(candidate, deps.setCandidates);
      break;
    }
    const response = await deps.sendFillMessageWithVerify(candidate.origin.tabId, candidate.block, candidate.result!, candidate.origin.url);
    totalQuestions += 1;
    if (response?.ok) totalFilled += response.filledCount ?? 0;
    const stillCurrent = await deps.isCandidateCurrent(candidate);
    if (response?.message === STALE_CANDIDATE_RESULT || !stillCurrent) {
      clearFilledCandidateResult(candidate, deps.setCandidates);
    }
    // A failed transaction or a lost origin fence ends this batch path. Never
    // repeat or advance to another candidate after an uncertain fill result.
    if (!response?.ok || !stillCurrent) break;
  }
  return { totalFilled, totalQuestions };
}

async function isAuthorized(candidate: DetectedCandidate, lease: CandidateAttemptLease, deps: AttemptDeps): Promise<boolean> {
  if (!deps.attempts.isCurrent(lease)) return false;
  const contextCurrent = await deps.isCandidateCurrent(candidate);
  return contextCurrent && deps.attempts.isCurrent(lease);
}

function setCandidateLoading(candidate: DetectedCandidate, lease: CandidateAttemptLease, deps: AttemptDeps): void {
  deps.setCandidates((previous) => previous.map((current) =>
    deps.attempts.isCurrent(lease) && candidateMatchesBlockAndOrigin(current, candidate.block, candidate.origin)
      ? { ...current, status: "loading" as const, error: undefined }
      : current,
  ));
}

async function commitCandidateResult(
  candidate: DetectedCandidate,
  lease: CandidateAttemptLease,
  historyBlock: QuestionBlock,
  result: ParseResult,
  debugInfo: NonNullable<DetectedCandidate["debugInfo"]>,
  deps: AttemptDeps,
): Promise<boolean> {
  if (!await isAuthorized(candidate, lease, deps)) {
    deps.logDiscardedStaleResult(candidate, result);
    clearStaleCandidate(candidate, deps, lease);
    return false;
  }
  const entry: HistoryEntry = {
    id: candidate.block.id,
    timestamp: Date.now(),
    block: historyBlock,
    result,
    host: hostForOrigin(candidate.origin),
  };
  const persisted = await deps.addHistoryEntryIfCurrent(entry, () => isAuthorized(candidate, lease, deps));
  if (!persisted) {
    if (!await isAuthorized(candidate, lease, deps)) {
      deps.logDiscardedStaleResult(candidate, result);
      clearStaleCandidate(candidate, deps, lease);
    } else if (deps.attempts.isCurrent(lease)) {
      recoverCandidateAfterError(candidate, lease, new Error("HISTORY_COMMIT_REJECTED"), deps);
    }
    return false;
  }
  // A successful history write is the parse commit event even if its origin
  // becomes stale while storage is pending. Later candidate state still needs
  // a fresh authority check.
  deps.logCommittedResult(candidate, result);
  if (!await isAuthorized(candidate, lease, deps)) {
    // Do not rewrite a stale candidate or erase a newer candidate here.
    return false;
  }
  deps.setCandidates((previous) => previous.map((current) =>
    deps.attempts.isCurrent(lease) && candidateMatchesBlockAndOrigin(current, candidate.block, candidate.origin)
      ? { ...current, status: "success" as const, result, error: undefined, debugInfo }
      : current,
  ));
  return true;
}

function discardStaleProviderResult(
  candidate: DetectedCandidate,
  lease: CandidateAttemptLease,
  result: ParseResult,
  deps: AttemptDeps,
): void {
  deps.logDiscardedStaleResult(candidate, result);
  clearStaleCandidate(candidate, deps, lease);
}

async function recoverCandidateAfterError(
  candidate: DetectedCandidate,
  lease: CandidateAttemptLease,
  error: unknown,
  deps: AttemptDeps,
): Promise<void> {
  if (!deps.attempts.isCurrent(lease)) return;
  if (!await deps.isCandidateCurrent(candidate)) {
    clearStaleCandidate(candidate, deps, lease);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  deps.setCandidates((previous) => previous.map((current) =>
    deps.attempts.isCurrent(lease) && candidateMatchesBlockAndOrigin(current, candidate.block, candidate.origin)
      ? current.status === "success" && current.result || candidate.status === "success" && candidate.result
        ? {
          ...current,
          status: "success" as const,
          result: current.result ?? candidate.result,
          error: undefined,
          debugInfo: { ...(current.debugInfo ?? candidate.debugInfo ?? {}), retryError: message },
        }
        : { ...current, status: "error" as const, error: message }
      : current,
  ));
}

function clearStaleCandidate(candidate: DetectedCandidate, deps: Pick<AttemptDeps, "attempts" | "setCandidates">, lease: CandidateAttemptLease | null): void {
  deps.setCandidates((previous) => previous.map((current) =>
    (!lease || deps.attempts.isCurrent(lease)) && candidateMatchesBlockAndOrigin(current, candidate.block, candidate.origin)
      ? { ...current, status: "idle" as const, result: undefined, error: STALE_CANDIDATE_RESULT, debugInfo: undefined }
      : current,
  ));
}

function clearFilledCandidateResult(candidate: DetectedCandidate, setCandidates: UpdateCandidates): void {
  setCandidates((previous) => previous.map((current) =>
    candidateMatchesBlockAndOrigin(current, candidate.block, candidate.origin)
      ? { ...current, status: "idle" as const, result: undefined, error: STALE_CANDIDATE_RESULT, debugInfo: undefined }
      : current,
  ));
}

function hostForOrigin(origin: CandidateOrigin | undefined): string {
  try {
    return origin?.url ? new URL(origin.url).hostname : "";
  } catch {
    return "";
  }
}
