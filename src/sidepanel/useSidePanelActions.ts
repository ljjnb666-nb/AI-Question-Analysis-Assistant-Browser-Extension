import { useCallback, useRef } from "react";
import type { DetectedCandidate } from "@/shared/types";
import { addHistoryEntryIfCurrent, loadSettings } from "@/shared/utils/storage";
import { getProvider, hasSufficientPreviewText, parseQuestion } from "@/shared/utils/parseRouter";
import { logEvent } from "@/shared/utils/analytics";
import { readProtectedWorkOwners, clearProtectedWorkOwner } from "@/shared/auth/protectedWorkOwner";
import {
  isChoiceLikeResult,
  isRiskyCandidate,
  langSafe,
  pickBatchReviewModel,
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
import { getBatchFillFeedback, getSingleFillFeedback } from "./sidepanelActionMessages";
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

type UseSidePanelActionsOptions = {
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
  protectedWork?: {
    current: {
      autoSolve: { active: boolean; tabId?: number };
      fullPage: { active: boolean; tabId?: number };
    };
  };
  setCandidates: React.Dispatch<React.SetStateAction<DetectedCandidate[]>>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setFillFeedback: React.Dispatch<React.SetStateAction<string>>;
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
    if (options.isAuthenticatedNow()) return true;
    options.setFillFeedback(
      options.uiLang === "en"
        ? "Sign-in verification required. Please check your session in Settings."
        : "需要登录验证，请在设置中确认登录状态。",
    );
    return false;
  }, [options]);
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
      const activeTab = await getBestActionTab();
      if (!activeTab?.id) return;
      // Last-responsible-moment recheck: selection sync reaches the content
      // runtime, so the authority must hold after the tab lookup awaited.
      if (!options.isAuthenticatedNow()) return;
      await sendProtectedTabMessageWithBootstrap(
        activeTab.id,
        { type: "UPDATE_CANDIDATE_SELECTION", ...payload },
        options.isAuthenticatedNow,
      );
    },
    [options],
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

  const handleDetect = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    const activeTab = await getBestActionTab();
    if (!activeTab?.id) return;
    // Last-responsible-moment recheck after the tab lookup await.
    if (!options.isAuthenticatedNow()) return;
    const response = await sendProtectedTabMessageWithBootstrap(
      activeTab.id,
      { type: "START_AUTO_DETECT" },
      options.isAuthenticatedNow,
    );
    // A rejected/authority-lost START — or one whose authority lapsed during
    // the dispatch itself — must not flip the UI into a stale running state
    // (AUTH-UI-INV-12/13).
    if (response.ok === false || !options.isAuthenticatedNow()) return;
    applyDetectState(resetDetectState());
  }, [applyDetectState, options, requireAuthenticatedAction]);

  const handleFullPageDetect = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    const activeTab = await getBestActionTab();
    if (!activeTab?.id) return;
    // Last-responsible-moment recheck after the tab lookup await. A full
    // page scan is long-running protected work: the owner record commits
    // (awaited) before the START so the auth-loss watchdog can always see
    // it, with the exact owner tab.
    if (!options.isAuthenticatedNow()) return;
    await options.markProtectedWork("fullPage", true, activeTab.id);
    // The owner write awaited — re-confirm the authority before dispatching:
    // a session lost during the owner commit must not start the workflow.
    if (!options.isAuthenticatedNow()) {
      await options.markProtectedWork("fullPage", false, activeTab.id);
      return;
    }
    const response = await sendProtectedTabMessageWithBootstrap(
      activeTab.id,
      { type: "START_FULL_PAGE_DETECT" },
      options.isAuthenticatedNow,
    );
    // Running UI state only after a confirmed transport dispatch with the
    // authority still holding; every failed path clears the exact owner
    // record it created (AUTH-UI-INV-12/13).
    if (response.ok === false || !options.isAuthenticatedNow()) {
      await options.markProtectedWork("fullPage", false, activeTab.id);
      return;
    }
    applyDetectState(startFullPageDetectState());
  }, [applyDetectState, options, requireAuthenticatedAction]);

  const handleCancelFullPage = useCallback(async () => {
    // AUTH-UI-INV-16: cancel EVERY recorded full-page owner — this surface's
    // zero-lag sync registry first, then the cross-surface owner set (a
    // Popup-started scan, or scans on several tabs) — each exactly once.
    // Legacy best-tab fallback only when no owner record exists at all.
    const cancelTabs = new Set<number>();
    const localTabId = options.protectedWork?.current.fullPage.tabId;
    if (localTabId != null) cancelTabs.add(localTabId);
    for (const entry of (await readProtectedWorkOwners()).fullPage) cancelTabs.add(entry.tabId);

    if (cancelTabs.size === 0) {
      const best = await getBestActionTab();
      if (best?.id) {
        await sendTabMessageWithBootstrap(best.id, { type: "FULL_PAGE_DETECT_CANCELLED" });
      }
    } else {
      await Promise.all(
        [...cancelTabs].map((tabId) =>
          sendTabMessageWithBootstrap(tabId, { type: "FULL_PAGE_DETECT_CANCELLED" }).catch(() => undefined),
        ),
      );
    }
    if (localTabId != null) options.markProtectedWork("fullPage", false, localTabId);
    options.setIsFullPageScan(false);
    options.setScanProgress(null);
    for (const tabId of cancelTabs) void clearProtectedWorkOwner("fullPage", tabId);
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
    const activeTab = await getBestActionTab();
    if (!activeTab?.id) return;
    // Last-responsible-moment recheck after the tab lookup await.
    if (!options.isAuthenticatedNow()) return;
    await sendProtectedTabMessageWithBootstrap(
      activeTab.id,
      { type: "HIGHLIGHT_CANDIDATE", blockId },
      options.isAuthenticatedNow,
    );
  }, [options, requireAuthenticatedAction]);

  const toggleDetails = useCallback((id: string) => {
    options.setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, [options]);

  const handleBatchParse = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    if (!options.candidates.some((candidate) => candidate.selected)) return;
    options.setIsBatchParsing(true);
    await runBatchParse(options.candidates, {
      loadSettings,
      getProvider,
      parseQuestion: (block, settings) => parseQuestion(block, settings, undefined, { deferSuccessTelemetry: true }),
      requestBlockImage,
      addHistoryEntryIfCurrent,
      logCommittedResult: (candidate, result) => logEvent("parse_success", { route: result.routeUsed, source: "sidepanel_commit" }),
      logDiscardedStaleResult: (candidate, result) => logEvent("provider_result_discarded_stale", { blockId: candidate.block.id, route: result.routeUsed, source: "sidepanel_commit" }),
      attempts: candidateAttempts,
      isCandidateCurrent,
      pickBatchReviewModel,
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
      loadSettings,
      getProvider,
      requestBlockImage,
      parseQuestion: (block, settings) => parseQuestion(block, settings, undefined, { deferSuccessTelemetry: true }),
      addHistoryEntryIfCurrent,
      logCommittedResult: (candidate, result) => logEvent("parse_success", { route: result.routeUsed, source: "sidepanel_commit" }),
      logDiscardedStaleResult: (candidate, result) => logEvent("provider_result_discarded_stale", { blockId: candidate.block.id, route: result.routeUsed, source: "sidepanel_commit" }),
      attempts: candidateAttempts,
      isCandidateCurrent,
      setCandidates: options.setCandidates,
      langSafe,
      pickBatchReviewModel,
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
      loadSettings,
      getProvider,
      requestBlockImage,
      parseQuestion: (block, settings) => parseQuestion(block, settings, undefined, { deferSuccessTelemetry: true }),
      addHistoryEntryIfCurrent,
      logCommittedResult: (candidate, result) => logEvent("parse_success", { route: result.routeUsed, source: "sidepanel_commit" }),
      logDiscardedStaleResult: (candidate, result) => logEvent("provider_result_discarded_stale", { blockId: candidate.block.id, route: result.routeUsed, source: "sidepanel_commit" }),
      attempts: candidateAttempts,
      isCandidateCurrent,
      setCandidates: options.setCandidates,
      langSafe,
      pickBatchReviewModel,
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
    options.setFillFeedback(getSingleFillFeedback(options.uiLang, !!response?.ok, response?.message));
    window.setTimeout(() => options.setFillFeedback(""), 2200);
  }, [options, isCandidateCurrent, requireAuthenticatedAction]);

  const handleBatchFill = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    options.setIsBatchFilling(true);
    const { totalFilled, totalQuestions } = await runBatchFill(options.candidates, {
      isCandidateCurrent,
      setCandidates: options.setCandidates,
      sendFillMessageWithVerify: (tabId, block, result, expectedUrl) =>
        sendFillMessageWithVerify(tabId, block, result, expectedUrl, isChoiceLikeResult),
    });
    options.setIsBatchFilling(false);
    options.setFillFeedback(getBatchFillFeedback(options.uiLang, totalFilled, totalQuestions));
    window.setTimeout(() => options.setFillFeedback(""), 2600);
  }, [options, isCandidateCurrent, requireAuthenticatedAction]);

  const handleStartAutoSolve = useCallback(async () => {
    if (!requireAuthenticatedAction()) return;
    const activeTab = await getBestActionTab();
    if (!activeTab?.id) return;
    // Last-responsible-moment recheck after the tab lookup await: an auth
    // loss while the lookup was pending must never resurrect the workflow
    // after the watchdog already sent STOP.
    if (!options.isAuthenticatedNow()) return;
    // Record the owner tab with the START (awaited): auth-loss termination
    // must go to the tab that actually runs the workflow, never to a
    // re-guessed best tab. The cross-surface owner is established BEFORE the
    // dispatch, and running UI state only flips on after a confirmed
    // transport dispatch with the authority still holding (AUTH-UI-INV-12
    // /13/16). Every failed path clears the exact owner record it created.
    await options.markProtectedWork("autoSolve", true, activeTab.id);
    if (!options.isAuthenticatedNow()) {
      await options.markProtectedWork("autoSolve", false, activeTab.id);
      return;
    }
    const response = await sendProtectedTabMessageWithBootstrap(
      activeTab.id,
      { type: "START_AUTO_SOLVE_ALL" },
      options.isAuthenticatedNow,
    );
    if (response.ok === false || !options.isAuthenticatedNow()) {
      await options.markProtectedWork("autoSolve", false, activeTab.id);
      return;
    }
    options.setFillFeedback("");
    options.setIsAutoSolving(true);
    options.setAutoSolveProgress(buildAutoSolveStartingState(options.uiLang));
  }, [options, requireAuthenticatedAction]);

  // STOP / CANCEL are deliberately NOT auth-gated: after an auth loss they
  // are the only way to terminate an already-started protected workflow.
  // AUTH-UI-INV-16: several tabs may run the same kind, so Stop resolves
  // EVERY recorded owner (this surface's sync registry, then the
  // cross-surface set) and sends one STOP per tab — never just the newest,
  // never a re-guessed best tab. Legacy best-tab fallback only when no
  // owner record exists at all.
  const handleStopAutoSolve = useCallback(async () => {
    const stopTabs = new Set<number>();
    const localTabId = options.protectedWork?.current.autoSolve.tabId;
    if (localTabId != null) stopTabs.add(localTabId);
    for (const entry of (await readProtectedWorkOwners()).autoSolve) stopTabs.add(entry.tabId);

    if (stopTabs.size === 0) {
      const best = await getBestActionTab();
      if (!best?.id) return;
      await sendTabMessageWithBootstrap(best.id, { type: "STOP_AUTO_SOLVE_ALL" });
    } else {
      await Promise.all(
        [...stopTabs].map((tabId) =>
          sendTabMessageWithBootstrap(tabId, { type: "STOP_AUTO_SOLVE_ALL" }).catch(() => undefined),
        ),
      );
    }
    if (localTabId != null) options.markProtectedWork("autoSolve", false, localTabId);
    for (const tabId of stopTabs) void clearProtectedWorkOwner("autoSolve", tabId);
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
