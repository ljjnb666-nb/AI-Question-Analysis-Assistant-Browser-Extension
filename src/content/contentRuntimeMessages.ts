import type { BoundingBox, ExtMessage, ParseResult, QuestionBlock, UpdateCandidateSelectionMsg, WorkspaceSnapshotResponse } from "@/shared/types";
import type { HighlightLayer } from "./highlight/HighlightLayer";
import type { CandidateStatusMap } from "./contentRuntimeState";
import { applySelectionUpdate as applySelectionUpdateCore } from "./layoutSync";
import { handleContentMessage } from "./contentMessageRouter";
import { isCurrentRuntimeQuestionBlock } from "./liveQuestionObservation";
import { isProtectedWorkGenerationId } from "@/shared/auth/protectedWorkOwner";

type RegisterContentRuntimeMessageHandlersOptions = {
  getWorkspaceSnapshot?: (expectedUrl: string) => WorkspaceSnapshotResponse;
  notifySelectionChanged?: () => void;
  cancelFullPageScan: (generationId?: string) => boolean | void;
  cancelManualCapture: () => void;
  candidateStatusMap: CandidateStatusMap;
  captureBlockImage: (bbox: BoundingBox) => Promise<string | null>;
  closeFloatingResult: () => void;
  clearHighlightLayer: () => void;
  fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult, options?: { mode?: "auto" | "manual"; expectedUrl?: string; isRuntimeCurrent?: () => boolean }) => Promise<unknown>;
  getActiveCandidates: () => QuestionBlock[];
  getActiveHighlightBlocks: () => QuestionBlock[];
  getHighlightLayer: () => HighlightLayer | null;
  handleAutoDetect: (requestId?: string) => void | Promise<void>;
  onViewportDetectError?: (requestId: string) => void;
  handleFullPageDetect: (generationId?: string) => boolean | void;
  notifySidePanel: (candidates: QuestionBlock[]) => void;
  refreshLayoutResizeObservation: () => void;
  resetDetectionArtifacts: () => void;
  startAutoSolveAll: (generationId?: string) => boolean | void;
  startManualCapture: (forceVisionMode: boolean) => void;
  stopAutoSolveAll: (generationId?: string) => boolean | void;
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
    if (message.type === "START_AUTO_DETECT" && message.requestId !== undefined) {
      const requestId = message.requestId;
      const expectedUrl = message.expectedUrl;
      // Keep the legacy untagged command unchanged. A tagged command requires
      // a valid exact-origin runtime and MUST return a terminal generation-bound
      // result, not merely a transport ACK.
      if (!isProtectedWorkGenerationId(requestId) || !expectedUrl || !/^https?:\/\//i.test(expectedUrl)) {
        sendResponse({ ok: false, error: "INVALID_VIEWPORT_REQUEST" });
        return false;
      }
      const before = options.getWorkspaceSnapshot?.(expectedUrl);
      const prior = before?.snapshot;
      if (!before?.ok || !prior || prior.disposed) {
        sendResponse({ ok: false, error: "STALE_VIEWPORT_ORIGIN" });
        return false;
      }
      const fail = (code: "VIEWPORT_DETECT_FAILED" | "VIEWPORT_RESULT_NOT_CURRENT") => {
        if (code === "VIEWPORT_DETECT_FAILED") options.onViewportDetectError?.(requestId);
        sendResponse({ ok: false, requestId, error: code });
      };
      try {
        const execution = options.handleAutoDetect(requestId);
        void Promise.resolve(execution).then(() => {
          if (options.isRuntimeCurrent && !options.isRuntimeCurrent()) {
            fail("VIEWPORT_RESULT_NOT_CURRENT");
            return;
          }
          const current = options.getWorkspaceSnapshot?.(expectedUrl);
          const after = current?.snapshot;
          if (!current?.ok || !after || after.disposed || after.originUrl !== expectedUrl
            || after.runtimeInstanceId !== prior.runtimeInstanceId
            || after.runtimeGeneration !== prior.runtimeGeneration
            || after.routeEpoch !== prior.routeEpoch
            || after.seq <= prior.seq
            || after.detection.mode !== "viewport" || after.detection.phase !== "completed"
            || after.detection.requestId !== requestId) {
            fail("VIEWPORT_RESULT_NOT_CURRENT");
            return;
          }
          sendResponse({ ok: true, requestId });
        }).catch(() => fail("VIEWPORT_DETECT_FAILED"));
      } catch {
        fail("VIEWPORT_DETECT_FAILED");
        return false;
      }
      return true;
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
