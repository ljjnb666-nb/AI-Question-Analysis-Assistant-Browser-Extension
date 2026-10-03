import type { BoundingBox, ExtMessage, ParseResult, QuestionBlock, UpdateCandidateSelectionMsg, WorkspaceSnapshotResponse } from "@/shared/types";
import type { HighlightLayer } from "./highlight/HighlightLayer";
import type { CandidateStatusMap } from "./contentRuntimeState";
import { applySelectionUpdate as applySelectionUpdateCore } from "./layoutSync";
import { handleContentMessage } from "./contentMessageRouter";
import { isCurrentRuntimeQuestionBlock } from "./liveQuestionObservation";

type RegisterContentRuntimeMessageHandlersOptions = {
  getWorkspaceSnapshot?: (expectedUrl: string) => WorkspaceSnapshotResponse;
  notifySelectionChanged?: () => void;
  cancelFullPageScan: () => void;
  cancelManualCapture: () => void;
  candidateStatusMap: CandidateStatusMap;
  captureBlockImage: (bbox: BoundingBox) => Promise<string | null>;
  closeFloatingResult: () => void;
  clearHighlightLayer: () => void;
  fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult, options?: { mode?: "auto" | "manual"; expectedUrl?: string; isRuntimeCurrent?: () => boolean }) => Promise<unknown>;
  getActiveCandidates: () => QuestionBlock[];
  getActiveHighlightBlocks: () => QuestionBlock[];
  getHighlightLayer: () => HighlightLayer | null;
  handleAutoDetect: () => void;
  handleFullPageDetect: () => void;
  notifySidePanel: (candidates: QuestionBlock[]) => void;
  refreshLayoutResizeObservation: () => void;
  resetDetectionArtifacts: () => void;
  startAutoSolveAll: () => void;
  startManualCapture: (forceVisionMode: boolean) => void;
  stopAutoSolveAll: () => void;
  stopSpaWatch: () => void;
  verifyParsedAnswerInPage: (block: QuestionBlock, result: ParseResult, expectedUrl?: string) => unknown;
  isRuntimeCurrent?: () => boolean;
};

export function registerContentRuntimeMessageHandlers(options: RegisterContentRuntimeMessageHandlersOptions) {
  const listener = createContentRuntimeMessageListener(options);
  chrome.runtime.onMessage.addListener(listener);
  return listener;
}

export function createContentRuntimeMessageListener(options: RegisterContentRuntimeMessageHandlersOptions) {
  return (message: ExtMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if (options.isRuntimeCurrent && !options.isRuntimeCurrent()) return false;
    if (message.type === "GET_CANDIDATE_WORKSPACE_SNAPSHOT") {
      sendResponse(options.getWorkspaceSnapshot?.(message.expectedUrl) ?? { ok: false });
      return false;
    }
    return handleContentMessage(message, sendResponse, {
      cancelFullPageScan: options.cancelFullPageScan,
      cancelManualCapture: options.cancelManualCapture,
      captureBlockImage: options.captureBlockImage,
      clearHighlights: () => {
        options.clearHighlightLayer();
        options.stopSpaWatch();
        options.resetDetectionArtifacts();
        options.refreshLayoutResizeObservation();
      },
      closeFloatingResult: options.closeFloatingResult,
      fillParsedAnswerInPage: options.fillParsedAnswerInPage,
      flashCandidate: (blockId) => {
        options.getHighlightLayer()?.flashBlock(blockId);
      },
      handleAutoDetect: options.handleAutoDetect,
      handleFullPageDetect: options.handleFullPageDetect,
      startAutoSolveAll: options.startAutoSolveAll,
      startManualCapture: options.startManualCapture,
      stopAutoSolveAll: options.stopAutoSolveAll,
      updateCandidateSelection: (nextMessage: UpdateCandidateSelectionMsg) => {
        applySelectionUpdateCore(nextMessage, {
          candidateStatusMap: options.candidateStatusMap,
          activeHighlightBlocks: options.getActiveHighlightBlocks(),
          activeCandidates: options.getActiveCandidates(),
          highlightLayer: options.getHighlightLayer(),
          notifySidePanel: options.notifySelectionChanged ? () => {} : options.notifySidePanel,
        });
        options.notifySelectionChanged?.();
      },
      validateQuestionResultAuthority: (block) => isCurrentRuntimeQuestionBlock(block),
      verifyParsedAnswerInPage: options.verifyParsedAnswerInPage,
    });
  };
}
