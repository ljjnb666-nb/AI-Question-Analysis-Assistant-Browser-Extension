import { loadParsePreferences, getAIConnectionReadiness, getRuntimeCaptureInfo } from "@/shared/utils/aiSolvePreferences";
import { useCallback, useRef } from "react";
import type { CandidateOrigin, DetectedCandidate } from "@/shared/types";
import { addHistoryEntryIfCurrent, loadSettings } from "@/shared/utils/storage";
import {
  getAutoSolveNotConfiguredMessage,
} from "@/shared/ai/parseResultAuthority";
import { hasSufficientPreviewText, parseQuestion } from "@/shared/utils/parseRouter";
import { mapKnownCodeFeedback, mapUserFacingError, userFeedback, type UserFeedback } from "@/shared/ui/userFeedback";
import { logEvent } from "@/shared/utils/analytics";
import { terminateRecordedProtectedWorkKind } from "@/shared/auth/protectedWorkOwner";
import {
  isChoiceLikeResult,
  isRiskyCandidate,
  langSafe,
  preferBatchRetryResult,
  preferVisionResult,
  shouldRetryBatchParseAfterError,
  shouldRetryBatchParseForIncompleteResult,
  shouldRetryWithVision,
} from "./batchParseHeuristics";
import {
  runBatchFill,
  runBatchParse,
  runFillCandidate,
  runRetryRisky,
  runRetryVision,
  selectRiskyCandidates,
} from "./batchOperations";
import { getBatchFillFeedback, getFillActionFeedback } from "./sidepanelActionMessages";
import { isCandidateFillReady } from "./sidepanelCandidateMetrics";
import { buildAutoSolveStartingState, resetDetectState, startFullPageDetectState, type AutoSolveProgressState, type ScanProgressState } from "./sidepanelStateSync";
import { clearCandidateSelection, selectAllCandidates, toggleCandidateSelection } from "./sidepanelSelectionSync";
import { createCandidateAttemptRegistry } from "./candidateAuthority";
import {
  getBestActionTab,
  isCandidateResultAuthorityCurrent,
  requestBlockImage,
  sendFillMessageWithVerify,
  sendProtectedTabMessageWithBootstrap,
  sendTabMessageWithBootstrap,
} from "./tabActions";
import type { UILang } from "./displayUtils";
import { requestWorkspaceSnapshot, readWorkspaceOrigin } from "./workspaceTarget";
import { viewportDetectionSnapshotFeedback } from "./viewportDetectionFeedback.rcPilot03a";

type UseSidePanelActionsOptions = {
  isWorkspaceReadyNow?: () => boolean;
  getWorkspaceOrigin?: () => CandidateOrigin | undefined;
  candidates: DetectedCandidate[];
  isBatchParsing: boolean;
  /**
   * Synchronous authority check against the live session coordinator —
   * never a React render snapshot, which would leave a stale-closure
   * window. Protected handlers must fail closed before any state mutation
   * or runtime/tab dispatch (AUTH-UI-INV-09), and again after every await
   * immediately before a dispatch (AUTH-UI-INV-12).
   */
  isAuthenticatedNow: () => boolean;
  /**
   * Synchronous registry of long-running protected runtime work, updated
   * synchronously when a START is dispatched and when termination/completion
   * happens. The auth-loss watchdog reads this instead of a passive-effect
   * state snapshot so termination authority cannot miss an active run
   * (AUTH-UI-INV-13). The registry records the owner tab: STOP/CANCEL target
   * the recorded owner, never a re-guessed best tab. The returned promise
   * resolves once the cross-surface owner write has committed — callers MUST
   * await it before dispatching and re-check authority afterwards, and on
   * every failed path clean up with the same exact (kind, tabId).
   */
  markProtectedWork: (kind: "autoSolve" | "fullPage", active: boolean, tabId: number) => Promise<void>;
  /** New protected START authority; when available, only dispatch after UUID persistence. */
  markProtectedWorkGeneration?: (kind: "autoSolve" | "fullPage", tabId: number) => Promise<string | null>;
  /** Roll back ONLY the START generation created by this request. */
  clearProtectedWorkGeneration?: (kind: "autoSolve" | "fullPage", tabId: number, generationId: string) => Promise<void>;
  /** Ref authority on the current START to reject a superseded pending dispatch. */
  isProtectedWorkGenerationCurrent?: (kind: "autoSolve" | "fullPage", tabId: number, generationId: string) => boolean;
  /** Reset the component-owned synchronous local intent, without broad storage cleanup. */
  clearProtectedWorkIntent?: (kind: "autoSolve" | "fullPage") => void;
  protectedWork?: {
    current: {
      autoSolve: { active: boolean; tabId?: number };
      fullPage: { active: boolean; tabId?: number };
    };
  };
  setCandidates: React.Dispatch<React.SetStateAction<DetectedCandidate[]>>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setFillFeedback: React.Dispatch<React.SetStateAction<UserFeedback | null>>;
  setIsAutoSolving: React.Dispatch<React.SetStateAction<boolean>>;
  setIsBatchFilling: React.Dispatch<React.SetStateAction<boolean>>;
  setIsBatchParsing: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDetecting: React.Dispatch<React.SetStateAction<boolean>>;
  setIsFullPageScan: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRetryingRisky: React.Dispatch<React.SetStateAction<boolean>>;
  setAutoSolveProgress: React.Dispatch<React.SetStateAction<AutoSolveProgressState>>;
  setScanProgress: React.Dispatch<React.SetStateAction<ScanProgressState>>;
  uiLang: UILang;
};

export function useSidePanelActions(options: UseSidePanelActionsOptions) {
  const candidateAttempts = useRef(createCandidateAttemptRegistry()).current;
  const requireAuthenticatedAction = useCallback((): boolean => {
    if (options.isWorkspaceReadyNow && !options.isWorkspaceReadyNow()) return false;
    if (options.isAuthenticatedNow()) return true;
    options.setFillFeedback(
      userFeedback(
        "warning",
        options.uiLang === "en"
          ? "Sign-in verification required. Please check your session in Settings."
          : "需要登录验证，请在设置中确认登录状态。",
        { code: "AUTHORITY_LOST" },
      ),
    );
    return false;
  }, [options]);
  const canDispatchToTab = useCallback((tab: chrome.tabs.Tab): boolean => {
    if (!options.isAuthenticatedNow()) return false;
    if (!options.getWorkspaceOrigin) return true;
    const origin = options.getWorkspaceOrigin();
    return !!options.isWorkspaceReadyNow?.() && !!origin && origin.tabId === tab.id && origin.url === tab.url;
  }, [options]);
  const getActionTab = useCallback(async (): Promise<chrome.tabs.Tab | null> => {
    if (!options.getWorkspaceOrigin) return getBestActionTab();
    const origin = options.getWorkspaceOrigin();
    if (!origin || !options.isWorkspaceReadyNow?.()) return null;
    try {
      const tab = await chrome.tabs.get(origin.tabId);
      return tab.url === origin.url && canDispatchToTab(tab) ? tab : null;
    } catch { return null; }
  }, [options, canDispatchToTab]);
  const isCandidateCurrent = useCallback(
    async (candidate: DetectedCandidate) => {
      // Auth loss invalidates every in-flight protected commit: batch parse,
      // retry, and fill results must not re-enter committed UI state or hit
      // the page after the session stopped being server-validated.
      if (!options.isAuthenticatedNow()) return false;
      const candidateCurrent = await isCandidateResultAuthorityCurrent(candidate.origin, candidate.block);
      // Last-responsible-moment recheck: the authority check itself awaits,
      // so the session can lapse mid-flight (AUTH-UI-INV-12).
      if (!options.isAuthenticatedNow()) return false;
      return candidateCurrent;
    },
    [options],
  );
  const syncSelection = useCallback(
    async (payload: { blockId?: string; selected?: boolean; selectAll?: boolean }) => {
      const activeTab = await getActionTab();
      if (!activeTab?.id) return;
      // Last-responsible-moment recheck: selection sync reaches the content
      // runtime, so the authority must hold after the tab lookup awaited.
      if (!canDispatchToTab(activeTab)) return;
      await sendProtectedTabMessageWithBootstrap(
        activeTab.id,
        { type: "UPDATE_CANDIDATE_SELECTION", ...payload },
        () => canDispatchToTab(activeTab),
      );
    },
    [getActionTab, canDispatchToTab],
  );

  const applyDetectState = useCallback(
    (next: ReturnType<typeof resetDetectState> | ReturnType<typeof startFullPageDetectState>) => {
      candidateAttempts.invalidateAll();
      options.setIsDetecting(next.isDetecting);
      options.setIsFullPageScan("isFullPageScan" in next ? next.isFullPageScan : true);
      options.setScanProgress(next.scanProgress);
      options.setCandidates(next.candidates);
      options.setExpandedIds(next.expandedIds);
    },
    [options, candidateAttempts],
  );

  // Side Panel-local single flight: repeated clicks must never schedule a
  // hidden parallel viewport detection while a dispatch/result read is pending.
  const viewportDetectInFlight = useRef(false);
  const handleDetect = useCallback(async () => {
    if (viewportDetectInFlight.current || !requireAuthenticatedAction()) return;
    viewportDetectInFlight.current = true;
    let dispatchedTab: chrome.tabs.Tab | null = null;
    options.setFillFeedback(userFeedback(
      "info",
      options.uiLang === "en" ? "Starting current-screen detection…" : "正在启动当前屏识别…",
      { code: "VIEWPORT_DETECT_STARTING" },
    ));
    try {
      const activeTab = await getActionTab();
      dispatchedTab = activeTab;
      if (!activeTab?.id) {
        if (options.isAuthenticatedNow()) options.setFillFeedback(userFeedback(
          "warning",
          options.uiLang === "en" ? "The current page is unavailable. Sync the workspace and try again." : "当前页面不可用，请重新同步工作区后重试。",
          { code: "VIEWPORT_DETECT_NO_TARGET" },
        ));
        return;
      }
      // The captured tab and exact URL remain the dispatch authority.
      if (!canDispatchToTab(activeTab)) return;
      const response = await sendProtectedTabMessageWithBootstrap<{ ok?: boolean }>(
        activeTab.id,
        { type: "START_AUTO_DETECT" },
        () => canDispatchToTab(activeTab),
      );
      if (!canDispatchToTab(activeTab)) return;
      // Transport success alone is only an ACK; it is not detection success.
      if (!response.ok || response.response?.ok !== true) {
        options.setFillFeedback(userFeedback(
          "error",
          options.uiLang === "en" ? "Current-screen detection could not be started. Check the page connection and retry." : "当前屏识别未能启动，请检查页面连接后重试。",
          { code: "VIEWPORT_DETECT_START_UNCONFIRMED", technicalDetail: response.error },
        ));
        return;
      }
      const origin = options.getWorkspaceOrigin?.();
      if (!origin) {
        // Legacy non-workspace caller retains its previous state path.
        applyDetectState(resetDetectState());
        options.setFillFeedback(userFeedback(
          "info",
          options.uiLang === "en" ? "Detection request sent. Awaiting verified workspace results." : "识别请求已发送，等待工作区确认结果。",
          { code: "VIEWPORT_DETECT_ACK_ONLY" },
        ));
        return;
      }
      if (origin.tabId !== activeTab.id || origin.url !== activeTab.url) return;
      // Only a content-owned, versioned snapshot can report a candidate count;
      // no legacy AUTO_DETECT_RESULT_READY payload is used as render authority.
      const snapshot = await requestWorkspaceSnapshot(origin, () => canDispatchToTab(activeTab));
      if (!canDispatchToTab(activeTab)) return;
      const after = await readWorkspaceOrigin(origin.tabId).catch(() => null);
      if (!canDispatchToTab(activeTab) || after?.url !== origin.url) return;
      options.setFillFeedback(viewportDetectionSnapshotFeedback(options.uiLang, origin, snapshot));
    } catch (error) {
      // A delayed exception from a superseded route may not overwrite feedback
      // for the newly selected tab. Preflight failures (no tab captured) still
      // produce explicit user feedback while authentication remains valid.
      if (options.isAuthenticatedNow() && (!dispatchedTab || canDispatchToTab(dispatchedTab))) options.setFillFeedback(userFeedback(
        "error",
        options.uiLang === "en" ? "Current-screen detection could not be confirmed. Retry after syncing the workspace." : "当前屏识别状态无法确认，请同步工作区后重试。",
        { code: "VIEWPORT_DETECT_DISPATCH_ERROR", technicalDetail: String(error) },
      ));
    } finally {
      viewportDetectInFlight.current = false;
    }
  }, [applyDetectState, options, requireAuthenticatedAction, getActionTab, canDispatchToTab]);

  const handleFullPageDetect = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    const activeTab = await getActionTab();
    if (!activeTab?.id) return;
    // Last-responsible-moment recheck after the tab lookup await. A full
    // page scan is long-running protected work: the owner record commits
    // (awaited) before the START so the auth-loss watchdog can always see
    // it, with the exact owner tab.
    if (!canDispatchToTab(activeTab)) return;
    const generationAware = Boolean(options.markProtectedWorkGeneration && options.clearProtectedWorkGeneration);
    let generationId: string | undefined;
    if (generationAware) {
      generationId = (await options.markProtectedWorkGeneration!("fullPage", activeTab.id)) ?? undefined;
      // Storage absence or revoked pending intent is never a legacy fallback.
      if (!generationId) return;
    } else {
      await options.markProtectedWork("fullPage", true, activeTab.id);
    }
    const rollbackOwner = () => generationId
      ? options.clearProtectedWorkGeneration!("fullPage", activeTab.id!, generationId)
      : options.markProtectedWork("fullPage", false, activeTab.id!);
    const isCurrentGeneration = () => !generationId
      || options.isProtectedWorkGenerationCurrent?.("fullPage", activeTab.id!, generationId) !== false;
    if (!canDispatchToTab(activeTab) || !isCurrentGeneration()) {
      await rollbackOwner();
      return;
    }
    const response = await sendProtectedTabMessageWithBootstrap(
      activeTab.id,
      generationId ? { type: "START_FULL_PAGE_DETECT", generationId } : { type: "START_FULL_PAGE_DETECT" },
      () => canDispatchToTab(activeTab),
    );
    if (response.ok === false || !canDispatchToTab(activeTab) || !isCurrentGeneration()) {
      await rollbackOwner();
      return;
    }
    if (!options.getWorkspaceOrigin) applyDetectState(startFullPageDetectState());
  }, [applyDetectState, options, requireAuthenticatedAction, getActionTab, canDispatchToTab]);

  const handleCancelFullPage = useCallback(async () => {
    // Reset local intent before awaiting a network/worker STOP. Never clear
    // all owner generations after the await: a newer same-tab START may exist.
    const localTabId = options.protectedWork?.current.fullPage.tabId;
    options.clearProtectedWorkIntent?.("fullPage");
    const dispatched = await terminateRecordedProtectedWorkKind(
      "fullPage",
      (tabId, message) => sendTabMessageWithBootstrap(tabId, message),
      localTabId,
    );
    if (dispatched === 0) {
      const best = await getBestActionTab();
      if (best?.id) await sendTabMessageWithBootstrap(best.id, { type: "FULL_PAGE_DETECT_CANCELLED" });
    }
    options.setIsFullPageScan(false);
    options.setScanProgress(null);
  }, [options]);

  const toggleSelect = useCallback(
    (id: string) => {
      if (!requireAuthenticatedAction()) return;
      options.setCandidates((prev) => {
        const next = toggleCandidateSelection(prev, id);
        const target = next.find((candidate) => candidate.block.id === id);
        void syncSelection({ blockId: id, selected: !!target?.selected });
        return next;
      });
    },
    [options, requireAuthenticatedAction, syncSelection],
  );

  const handleFlash = useCallback(async (blockId: string) => {
    if (!requireAuthenticatedAction()) return;
    const activeTab = await getActionTab();
    if (!activeTab?.id) return;
    // Last-responsible-moment recheck after the tab lookup await.
    if (!canDispatchToTab(activeTab)) return;
    await sendProtectedTabMessageWithBootstrap(
      activeTab.id,
      { type: "HIGHLIGHT_CANDIDATE", blockId },
      () => canDispatchToTab(activeTab),
    );
  }, [requireAuthenticatedAction, getActionTab, canDispatchToTab]);

  const toggleDetails = useCallback((id: string) => {
    options.setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, [options]);

  const handleBatchParse = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    if (!options.candidates.some((candidate) => candidate.selected)) return;
    options.setIsBatchParsing(true);
    await runBatchParse(options.candidates, {
      loadSettings: loadParsePreferences,
      getRuntimeCaptureInfo,
      parseQuestion: (block, settings, context) => parseQuestion(block, settings, undefined, { ...context, deferSuccessTelemetry: true }),
      requestBlockImage,
      addHistoryEntryIfCurrent,
      logCommittedResult: (candidate, result) => logEvent("parse_success", { route: result.routeUsed, source: "sidepanel_commit" }),
      logDiscardedStaleResult: (candidate, result) => logEvent("provider_result_discarded_stale", { blockId: candidate.block.id, route: result.routeUsed, source: "sidepanel_commit" }),
      attempts: candidateAttempts,
      isCandidateCurrent,
          shouldRetryBatchParseAfterError,
      shouldRetryWithVision,
      preferVisionResult,
      hasSufficientPreviewText,
      langSafe,
      shouldRetryBatchParseForIncompleteResult,
      preferBatchRetryResult,
      setCandidates: options.setCandidates,
    });
    options.setIsBatchParsing(false);
  }, [options, candidateAttempts, isCandidateCurrent, requireAuthenticatedAction]);

  const handleRetryVision = useCallback(async (candidate: DetectedCandidate) => {
    if (!requireAuthenticatedAction()) return;
    await runRetryVision(candidate, {
      loadSettings: loadParsePreferences,
      getRuntimeCaptureInfo,
      requestBlockImage,
      parseQuestion: (block, settings, context) => parseQuestion(block, settings, undefined, { ...context, deferSuccessTelemetry: true }),
      addHistoryEntryIfCurrent,
      logCommittedResult: (candidate, result) => logEvent("parse_success", { route: result.routeUsed, source: "sidepanel_commit" }),
      logDiscardedStaleResult: (candidate, result) => logEvent("provider_result_discarded_stale", { blockId: candidate.block.id, route: result.routeUsed, source: "sidepanel_commit" }),
      attempts: candidateAttempts,
      isCandidateCurrent,
      setCandidates: options.setCandidates,
      langSafe,
          shouldRetryBatchParseForIncompleteResult,
      preferBatchRetryResult,
    });
  }, [options.setCandidates, candidateAttempts, isCandidateCurrent, requireAuthenticatedAction]);

  const handleSelectRisky = useCallback(() => {
    if (!requireAuthenticatedAction()) return;
    options.setCandidates((prev) => {
      const { next, selectedIds } = selectRiskyCandidates(prev, isRiskyCandidate);
      for (const candidate of next) {
        void syncSelection({ blockId: candidate.block.id, selected: selectedIds.has(candidate.block.id) });
      }
      return next;
    });
  }, [options, requireAuthenticatedAction, syncSelection]);

  const handleRetryRisky = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    if (!options.candidates.some(isRiskyCandidate)) return;

    options.setIsRetryingRisky(true);
    await runRetryRisky(options.candidates, isRiskyCandidate, {
      loadSettings: loadParsePreferences,
      getRuntimeCaptureInfo,
      requestBlockImage,
      parseQuestion: (block, settings, context) => parseQuestion(block, settings, undefined, { ...context, deferSuccessTelemetry: true }),
      addHistoryEntryIfCurrent,
      logCommittedResult: (candidate, result) => logEvent("parse_success", { route: result.routeUsed, source: "sidepanel_commit" }),
      logDiscardedStaleResult: (candidate, result) => logEvent("provider_result_discarded_stale", { blockId: candidate.block.id, route: result.routeUsed, source: "sidepanel_commit" }),
      attempts: candidateAttempts,
      isCandidateCurrent,
      setCandidates: options.setCandidates,
      langSafe,
          shouldRetryBatchParseForIncompleteResult,
      preferBatchRetryResult,
    });
    options.setIsRetryingRisky(false);
  }, [options, candidateAttempts, isCandidateCurrent, requireAuthenticatedAction]);

  const handleFillCandidate = useCallback(async (candidate: DetectedCandidate) => {
    if (!requireAuthenticatedAction()) return;
    const response = await runFillCandidate(candidate, {
      isCandidateCurrent,
      setCandidates: options.setCandidates,
      sendFillMessageWithVerify: (tabId, block, result, expectedUrl) =>
        sendFillMessageWithVerify(tabId, block, result, expectedUrl, isChoiceLikeResult),
    });
    // UI-00B: typed feedback; provenance rejections surface as natural hints
    // with the machine code demoted to `code`.
    options.setFillFeedback(getFillActionFeedback(options.uiLang, response));
    window.setTimeout(() => options.setFillFeedback(null), 2200);
  }, [options, isCandidateCurrent, requireAuthenticatedAction]);

  const handleBatchFill = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    // UI-00B PART E: a selection with no fillable result never starts a batch
    // mutation and never reports a misleading "0 of 0" outcome. With nothing
    // selected at all the ordinary no-selection state stands — no error, no
    // empty success banner.
    const selectedCount = options.candidates.filter((candidate) => candidate.selected).length;
    const fillableCount = options.candidates.filter(isCandidateFillReady).length;
    if (selectedCount === 0) return;
    if (fillableCount === 0) {
      options.setFillFeedback(
        userFeedback(
          "warning",
          options.uiLang === "en"
            ? "None of the selected questions has a fillable result. Parse them again first."
            : "选中的题目没有可填写的有效解析结果，请重新解析后再试。",
          { code: "BATCH_FILL_NOTHING_FILLABLE" },
        ),
      );
      window.setTimeout(() => options.setFillFeedback(null), 3200);
      return;
    }
    options.setIsBatchFilling(true);
    const { successfulQuestions, attemptedQuestions, totalFilled, withheldCount, failureCode, failureMessage } = await runBatchFill(options.candidates, {
      isCandidateCurrent,
      setCandidates: options.setCandidates,
      sendFillMessageWithVerify: (tabId, block, result, expectedUrl) =>
        sendFillMessageWithVerify(tabId, block, result, expectedUrl, isChoiceLikeResult),
    });
    options.setIsBatchFilling(false);
    // UI-00B review fix 02: a run failed when a failure was recorded or a
    // dispatched fill did not succeed — a missing machine code is still a
    // failure. The failure copy always comes from the authoritative central
    // mapper (known codes and transport shapes included); the handler never
    // reclassifies by itself.
    const failed = failureCode !== undefined || failureMessage !== undefined || attemptedQuestions > successfulQuestions;
    if (failed) {
      const mapped = mapUserFacingError(failureMessage ?? failureCode, options.uiLang, { code: failureCode });
      const prefix = successfulQuestions > 0
        ? (options.uiLang === "en" ? `Filled ${successfulQuestions} question(s); ` : `已填写 ${successfulQuestions} 题；`)
        : "";
      options.setFillFeedback({
        ...mapped,
        message: `${prefix}${mapped.message}`,
      });
      window.setTimeout(() => options.setFillFeedback(null), 4000);
      return;
    }
    // UI-00B PART E: skipped = selected-but-unfillable results (mock, legacy,
    // extraction-failed) plus fill-ready candidates the run could not attempt.
    const unfillableSelected = selectedCount - fillableCount;
    options.setFillFeedback(getBatchFillFeedback(options.uiLang, successfulQuestions, totalFilled, unfillableSelected + withheldCount));
    window.setTimeout(() => options.setFillFeedback(null), 2600);
  }, [options, isCandidateCurrent, requireAuthenticatedAction]);

  const handleStartAutoSolve = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    // UI-00A entry guard: Auto Solve is a protected real-page workflow and
    // must not start (and never fall back to demo answers) without a usable
    // provider. The content-side entry guard and the fill-core provenance
    // gate remain as the second and third layers.
    const settings = await loadSettings();
    if (!(await getAIConnectionReadiness()).ready) {
      options.setFillFeedback(
        mapKnownCodeFeedback("PROVIDER_NOT_CONFIGURED", options.uiLang)
        ?? userFeedback("warning", getAutoSolveNotConfiguredMessage(settings.language)),
      );
      window.setTimeout(() => options.setFillFeedback(null), 3200);
      return;
    }
    const activeTab = await getActionTab();
    if (!activeTab?.id) return;
    // Last-responsible-moment recheck after the tab lookup await: an auth
    // loss while the lookup was pending must never resurrect the workflow
    // after the watchdog already sent STOP.
    if (!canDispatchToTab(activeTab)) return;
    // Record the owner tab with the START (awaited): auth-loss termination
    // must go to the tab that actually runs the workflow, never to a
    // re-guessed best tab. The cross-surface owner is established BEFORE the
    // dispatch, and running UI state only flips on after a confirmed
    // transport dispatch with the authority still holding (AUTH-UI-INV-12
    // /13/16). Every failed path clears the exact owner record it created.
    const generationAware = Boolean(options.markProtectedWorkGeneration && options.clearProtectedWorkGeneration);
    let generationId: string | undefined;
    if (generationAware) {
      generationId = (await options.markProtectedWorkGeneration!("autoSolve", activeTab.id)) ?? undefined;
      if (!generationId) {
        // A missing session store or superseded mark must never START.
        return;
      }
    } else {
      // Legacy callers and test harnesses migrate independently.
      await options.markProtectedWork("autoSolve", true, activeTab.id);
    }
    const rollbackOwner = () => generationId
      ? options.clearProtectedWorkGeneration!("autoSolve", activeTab.id!, generationId)
      : options.markProtectedWork("autoSolve", false, activeTab.id!);
    const currentGeneration = () => !generationId
      || options.isProtectedWorkGenerationCurrent?.("autoSolve", activeTab.id!, generationId) !== false;
    if (!canDispatchToTab(activeTab) || !currentGeneration()) {
      await rollbackOwner();
      return;
    }
    const response = await sendProtectedTabMessageWithBootstrap(
      activeTab.id,
      generationId ? { type: "START_AUTO_SOLVE_ALL", generationId } : { type: "START_AUTO_SOLVE_ALL" },
      () => canDispatchToTab(activeTab),
    );
    if (response.ok === false || !canDispatchToTab(activeTab) || !currentGeneration()) {
      await rollbackOwner();
      return;
    }
    options.setFillFeedback(null);
    if (!options.getWorkspaceOrigin) {
      options.setIsAutoSolving(true);
      options.setAutoSolveProgress(buildAutoSolveStartingState(options.uiLang));
    }
  }, [options, requireAuthenticatedAction, getActionTab, canDispatchToTab]);

  // STOP / CANCEL are deliberately NOT auth-gated: after an auth loss they
  // are the only way to terminate an already-started protected workflow.
  // AUTH-UI-INV-16: several tabs may run the same kind, so Stop resolves
  // EVERY recorded owner (this surface's sync registry, then the
  // cross-surface set) and sends one STOP per tab — never just the newest,
  // never a re-guessed best tab. Legacy best-tab fallback only when no
  // owner record exists at all.
  const handleStopAutoSolve = useCallback(async () => {
    const localTabId = options.protectedWork?.current.autoSolve.tabId;
    options.clearProtectedWorkIntent?.("autoSolve");
    const dispatched = await terminateRecordedProtectedWorkKind(
      "autoSolve",
      (tabId, message) => sendTabMessageWithBootstrap(tabId, message),
      localTabId,
    );
    if (dispatched === 0) {
      const best = await getBestActionTab();
      if (best?.id) await sendTabMessageWithBootstrap(best.id, { type: "STOP_AUTO_SOLVE_ALL" });
    }
  }, [options]);

  const handleClearSelection = useCallback(() => {
    if (!requireAuthenticatedAction()) return;
    options.setCandidates((prev) => clearCandidateSelection(prev));
    void syncSelection({ selectAll: false });
  }, [options, requireAuthenticatedAction, syncSelection]);

  const handleSelectAll = useCallback(() => {
    if (!requireAuthenticatedAction()) return;
    options.setCandidates((prev) => selectAllCandidates(prev));
    void syncSelection({ selectAll: true });
  }, [options, requireAuthenticatedAction, syncSelection]);

  return {
    handleBatchFill,
    handleBatchParse,
    handleCancelFullPage,
    handleClearSelection,
    handleDetect,
    handleFillCandidate,
    handleFlash,
    handleFullPageDetect,
    handleRetryRisky,
    handleRetryVision,
    handleSelectAll,
    handleSelectRisky,
    handleStartAutoSolve,
    handleStopAutoSolve,
    toggleDetails,
    toggleSelect,
  };
}
