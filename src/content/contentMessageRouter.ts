import type { BoundingBox, ExtMessage, ParseResult, QuestionBlock, UpdateCandidateSelectionMsg } from "@/shared/types";

type MessageResponse = (response: unknown) => void;

type ContentMessageRouterDeps = {
  cancelFullPageScan: () => void;
  cancelManualCapture: () => void;
  captureBlockImage: (bbox: BoundingBox) => Promise<string | null>;
  clearHighlights: () => void;
  closeFloatingResult: () => void;
  fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => Promise<unknown>;
  flashCandidate: (blockId: string) => void;
  handleAutoDetect: () => void;
  handleFullPageDetect: () => void;
  startAutoSolveAll: () => void;
  startManualCapture: (forceVisionMode: boolean) => void;
  stopAutoSolveAll: () => void;
  updateCandidateSelection: (message: UpdateCandidateSelectionMsg) => void;
  verifyParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => unknown;
};

export function handleContentMessage(
  message: ExtMessage,
  sendResponse: MessageResponse,
  deps: ContentMessageRouterDeps,
): boolean {
  switch (message.type) {
    case "START_MANUAL_CAPTURE":
      deps.startManualCapture(false);
      sendResponse({ ok: true });
      return false;

    case "CANCEL_MANUAL_CAPTURE":
      deps.cancelManualCapture();
      sendResponse({ ok: true });
      return false;

    case "CLOSE_FLOATING_RESULT":
      deps.closeFloatingResult();
      sendResponse({ ok: true });
      return false;

    case "START_AUTO_DETECT":
      deps.handleAutoDetect();
      sendResponse({ ok: true });
      return false;

    case "HIGHLIGHT_CANDIDATE":
      if ("blockId" in message && typeof message.blockId === "string") deps.flashCandidate(message.blockId);
      sendResponse({ ok: true });
      return false;

    case "UPDATE_CANDIDATE_SELECTION":
      deps.updateCandidateSelection(message);
      sendResponse({ ok: true });
      return false;

    case "CLEAR_HIGHLIGHTS":
      deps.clearHighlights();
      sendResponse({ ok: true });
      return false;

    case "START_FULL_PAGE_DETECT":
      deps.handleFullPageDetect();
      sendResponse({ ok: true });
      return false;

    case "FULL_PAGE_DETECT_CANCELLED":
      deps.cancelFullPageScan();
      sendResponse({ ok: true });
      return false;

    case "CAPTURE_BLOCK_IMAGE":
      if (!("bbox" in message) || !message.bbox) {
        sendResponse({ ok: false, error: "Missing bbox" });
        return false;
      }
      void (async () => {
        try {
          const dataUrl = await deps.captureBlockImage(message.bbox as BoundingBox);
          sendResponse({ ok: !!dataUrl, dataUrl: dataUrl ?? undefined });
        } catch (err) {
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return true;

    case "FILL_PARSED_ANSWER":
      if (!("block" in message) || !("result" in message) || !message.block || !message.result) {
        sendResponse({ ok: false, error: "Missing fill payload" });
        return false;
      }
      void (async () => {
        try {
          const fillResult = await deps.fillParsedAnswerInPage(message.block as QuestionBlock, message.result as ParseResult);
          sendResponse(fillResult);
        } catch (err) {
          sendResponse({ ok: false, filledCount: 0, message: err instanceof Error ? err.message : String(err) });
        }
      })();
      return true;

    case "VERIFY_PARSED_ANSWER":
      if (!("block" in message) || !("result" in message) || !message.block || !message.result) {
        sendResponse({ ok: false, error: "Missing verify payload" });
        return false;
      }
      void (async () => {
        try {
          const verifyResult = deps.verifyParsedAnswerInPage(message.block as QuestionBlock, message.result as ParseResult);
          sendResponse(verifyResult);
        } catch (err) {
          sendResponse({
            ok: false,
            expectedKeys: [],
            actualKeys: [],
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      return true;

    case "START_AUTO_SOLVE_ALL":
      deps.startAutoSolveAll();
      sendResponse({ ok: true });
      return false;

    case "STOP_AUTO_SOLVE_ALL":
      deps.stopAutoSolveAll();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
}
