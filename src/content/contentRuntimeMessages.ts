import type { BoundingBox, ExtMessage, ParseResult, QuestionBlock, UpdateCandidateSelectionMsg } from "@/shared/types";
import type { HighlightLayer } from "./highlight/HighlightLayer";
import type { CandidateStatusMap } from "./contentRuntimeState";
import { applySelectionUpdate as applySelectionUpdateCore } from "./layoutSync";
import { handleContentMessage } from "./contentMessageRouter";

type RegisterContentRuntimeMessageHandlersOptions = {
  cancelFullPageScan: () => void;
  cancelManualCapture: () => void;
  candidateStatusMap: CandidateStatusMap;
  captureBlockImage: (bbox: BoundingBox) => Promise<string | null>;
  closeFloatingResult: () => void;
  clearHighlightLayer: () => void;
  fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => Promise<unknown>;
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
  verifyParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => unknown;
};

export function registerContentRuntimeMessageHandlers(options: RegisterContentRuntimeMessageHandlersOptions) {
  chrome.runtime.onMessage.addListener(createContentRuntimeMessageListener(options));
}

export function createContentRuntimeMessageListener(options: RegisterContentRuntimeMessageHandlersOptions) {
  return (message: ExtMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
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
          notifySidePanel: options.notifySidePanel,
        });
      },
      verifyParsedAnswerInPage: options.verifyParsedAnswerInPage,
    });
  };
}
