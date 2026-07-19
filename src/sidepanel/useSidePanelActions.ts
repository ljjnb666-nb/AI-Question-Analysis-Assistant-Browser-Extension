import { useCallback } from "react";
import type { DetectedCandidate } from "@/shared/types";
import { addHistoryEntry, loadSettings } from "@/shared/utils/storage";
import { getProvider, hasSufficientPreviewText, parseQuestion } from "@/shared/utils/parseRouter";
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
import {
  getBestActionTab,
  requestBlockImage,
  sendFillMessageWithVerify,
  sendTabMessageWithBootstrap,
} from "./tabActions";
import type { UILang } from "./displayUtils";

type UseSidePanelActionsOptions = {
  candidates: DetectedCandidate[];
  isBatchParsing: boolean;
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
  const syncSelection = useCallback(
    async (payload: { blockId?: string; selected?: boolean; selectAll?: boolean }) => {
      const activeTab = await getBestActionTab();
      if (activeTab?.id) {
        await sendTabMessageWithBootstrap(activeTab.id, { type: "UPDATE_CANDIDATE_SELECTION", ...payload });
      }
    },
    [],
  );

  const applyDetectState = useCallback(
    (next: ReturnType<typeof resetDetectState> | ReturnType<typeof startFullPageDetectState>) => {
      options.setIsDetecting(next.isDetecting);
      options.setIsFullPageScan("isFullPageScan" in next ? next.isFullPageScan : true);
      options.setScanProgress(next.scanProgress);
      options.setCandidates(next.candidates);
      options.setExpandedIds(next.expandedIds);
    },
    [options],
  );

  const handleDetect = useCallback(async () => {
    applyDetectState(resetDetectState());
    const activeTab = await getBestActionTab();
    if (activeTab?.id) {
      await sendTabMessageWithBootstrap(activeTab.id, { type: "START_AUTO_DETECT" });
    }
  }, [applyDetectState]);

  const handleFullPageDetect = useCallback(async () => {
    applyDetectState(startFullPageDetectState());
    const activeTab = await getBestActionTab();
    if (activeTab?.id) {
      await sendTabMessageWithBootstrap(activeTab.id, { type: "START_FULL_PAGE_DETECT" });
    }
  }, [applyDetectState]);

  const handleCancelFullPage = useCallback(async () => {
    const activeTab = await getBestActionTab();
    if (activeTab?.id) {
      await sendTabMessageWithBootstrap(activeTab.id, { type: "FULL_PAGE_DETECT_CANCELLED" });
    }
    options.setIsFullPageScan(false);
    options.setScanProgress(null);
  }, [options]);

  const toggleSelect = useCallback(
    (id: string) => {
      options.setCandidates((prev) => {
        const next = toggleCandidateSelection(prev, id);
        const target = next.find((candidate) => candidate.block.id === id);
        void syncSelection({ blockId: id, selected: !!target?.selected });
        return next;
      });
    },
    [options, syncSelection],
  );

  const handleFlash = useCallback(async (blockId: string) => {
    const activeTab = await getBestActionTab();
    if (activeTab?.id) {
      await sendTabMessageWithBootstrap(activeTab.id, { type: "HIGHLIGHT_CANDIDATE", blockId });
    }
  }, []);

  const toggleDetails = useCallback((id: string) => {
    options.setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, [options]);

  const handleBatchParse = useCallback(async () => {
    if (!options.candidates.some((candidate) => candidate.selected)) return;
    options.setIsBatchParsing(true);
    const activeTab = await getBestActionTab();
    await runBatchParse(options.candidates, activeTab, {
      loadSettings,
      getProvider,
      parseQuestion,
      requestBlockImage,
      addHistoryEntry,
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
  }, [options]);

  const handleRetryVision = useCallback(async (candidate: DetectedCandidate) => {
    const activeTab = await getBestActionTab();
    await runRetryVision(candidate, activeTab, {
      loadSettings,
      getProvider,
      requestBlockImage,
      parseQuestion,
      addHistoryEntry,
      setCandidates: options.setCandidates,
      langSafe,
      pickBatchReviewModel,
      shouldRetryBatchParseForIncompleteResult,
      preferBatchRetryResult,
    });
  }, [options.setCandidates]);

  const handleSelectRisky = useCallback(() => {
    options.setCandidates((prev) => {
      const { next, selectedIds } = selectRiskyCandidates(prev, isRiskyCandidate);
      for (const candidate of next) {
        void syncSelection({ blockId: candidate.block.id, selected: selectedIds.has(candidate.block.id) });
      }
      return next;
    });
  }, [options, syncSelection]);

  const handleRetryRisky = useCallback(async () => {
    const activeTab = await getBestActionTab();
    if (!options.candidates.some(isRiskyCandidate)) return;

    options.setIsRetryingRisky(true);
    await runRetryRisky(options.candidates, activeTab, isRiskyCandidate, {
      loadSettings,
      getProvider,
      requestBlockImage,
      parseQuestion,
      addHistoryEntry,
      setCandidates: options.setCandidates,
      langSafe,
      pickBatchReviewModel,
      shouldRetryBatchParseForIncompleteResult,
      preferBatchRetryResult,
    });
    options.setIsRetryingRisky(false);
  }, [options]);

  const handleFillCandidate = useCallback(async (candidate: DetectedCandidate) => {
    const response = await runFillCandidate(candidate, {
      getBestActionTab,
      sendFillMessageWithVerify: (tabId, block, result) =>
        sendFillMessageWithVerify(tabId, block, result, isChoiceLikeResult),
    });
    options.setFillFeedback(getSingleFillFeedback(options.uiLang, !!response?.ok, response?.message));
    window.setTimeout(() => options.setFillFeedback(""), 2200);
  }, [options]);

  const handleBatchFill = useCallback(async () => {
    options.setIsBatchFilling(true);
    const { totalFilled, totalQuestions } = await runBatchFill(options.candidates, {
      getBestActionTab,
      sendFillMessageWithVerify: (tabId, block, result) =>
        sendFillMessageWithVerify(tabId, block, result, isChoiceLikeResult),
    });
    options.setIsBatchFilling(false);
    options.setFillFeedback(getBatchFillFeedback(options.uiLang, totalFilled, totalQuestions));
    window.setTimeout(() => options.setFillFeedback(""), 2600);
  }, [options]);

  const handleStartAutoSolve = useCallback(async () => {
    const activeTab = await getBestActionTab();
    if (!activeTab?.id) return;
    options.setFillFeedback("");
    options.setIsAutoSolving(true);
    options.setAutoSolveProgress(buildAutoSolveStartingState(options.uiLang));
    await sendTabMessageWithBootstrap(activeTab.id, { type: "START_AUTO_SOLVE_ALL" });
  }, [options]);

  const handleStopAutoSolve = useCallback(async () => {
    const activeTab = await getBestActionTab();
    if (!activeTab?.id) return;
    await sendTabMessageWithBootstrap(activeTab.id, { type: "STOP_AUTO_SOLVE_ALL" });
  }, []);

  const handleClearSelection = useCallback(() => {
    options.setCandidates((prev) => clearCandidateSelection(prev));
    void syncSelection({ selectAll: false });
  }, [options, syncSelection]);

  const handleSelectAll = useCallback(() => {
    options.setCandidates((prev) => selectAllCandidates(prev));
    void syncSelection({ selectAll: true });
  }, [options, syncSelection]);

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
