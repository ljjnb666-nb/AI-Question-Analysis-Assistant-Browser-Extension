import type { BoundingBox, ExtMessage, ParseResult, QuestionBlock, UpdateCandidateSelectionMsg } from "@/shared/types";
import { getUnfillableResultCode, isParseResultFillAuthoritative } from "@/shared/ai/parseResultAuthority";
import { isProtectedWorkGenerationId } from "@/shared/auth/protectedWorkOwner";

type MessageResponse = (response: unknown) => void;

type ContentMessageRouterDeps = {
  cancelFullPageScan: (generationId?: string) => boolean | void;
  cancelManualCapture: () => void;
  captureBlockImage: (bbox: BoundingBox) => Promise<string | null>;
  clearHighlights: () => void;
  closeFloatingResult: () => void;
  fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult, options: { mode: "manual"; expectedUrl?: string }) => Promise<unknown>;
  flashCandidate: (blockId: string) => void;
  handleAutoDetect: () => void;
  handleFullPageDetect: (generationId?: string) => boolean | void;
  startAutoSolveAll: (generationId?: string) => boolean | void;
  startManualCapture: (forceVisionMode: boolean) => void;
  stopAutoSolveAll: (generationId?: string) => boolean | void;
  updateCandidateSelection: (message: UpdateCandidateSelectionMsg) => void;
  validateQuestionResultAuthority: (block: QuestionBlock, expectedUrl: string) => boolean;
  verifyParsedAnswerInPage: (block: QuestionBlock, result: ParseResult, expectedUrl?: string) => unknown;
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
      if (message.generationId !== undefined && !isProtectedWorkGenerationId(message.generationId)) {
        sendResponse({ ok: false, error: "INVALID_WORK_GENERATION" });
        return false;
      }
      if (deps.handleFullPageDetect(message.generationId) === false) {
        sendResponse({ ok: false, error: "WORK_ALREADY_RUNNING" });
        return false;
      }
      sendResponse({ ok: true });
      return false;

    case "FULL_PAGE_DETECT_CANCELLED":
      if (message.generationId !== undefined && !isProtectedWorkGenerationId(message.generationId)) {
        sendResponse({ ok: false, error: "INVALID_WORK_GENERATION" });
        return false;
      }
      if (deps.cancelFullPageScan(message.generationId) === false) {
        sendResponse({ ok: false, error: "STALE_WORK_GENERATION" });
        return false;
      }
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

    case "VALIDATE_QUESTION_RESULT_AUTHORITY":
      sendResponse({
        ok: "block" in message
          && Boolean(message.block)
          && typeof message.expectedUrl === "string"
          && message.expectedUrl === location.href
          && deps.validateQuestionResultAuthority(message.block, message.expectedUrl),
        currentUrl: location.href,
      });
      return false;

    case "FILL_PARSED_ANSWER":
      if (!("block" in message) || !("result" in message) || !message.block || !message.result) {
        sendResponse({ ok: false, error: "Missing fill payload" });
        return false;
      }
      // UI-00A message-boundary gate: mock or legacy-unproven results are
      // rejected before the fill core is even reached.
      if (!isParseResultFillAuthoritative(message.result as ParseResult)) {
        const code = getUnfillableResultCode(message.result as ParseResult);
        sendResponse({ ok: false, filledCount: 0, code, message: code });
        return false;
      }
      if (message.expectedUrl !== undefined
        && (typeof message.expectedUrl !== "string" || message.expectedUrl !== location.href)) {
        sendResponse({ ok: false, filledCount: 0, code: "STALE_QUESTION_REVISION", message: "STALE_QUESTION_REVISION" });
        return false;
      }
      void (async () => {
        try {
          const fillResult = await deps.fillParsedAnswerInPage(
            message.block as QuestionBlock,
            message.result as ParseResult,
            { mode: "manual", expectedUrl: message.expectedUrl },
          );
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
      if (typeof message.expectedUrl !== "string" || message.expectedUrl !== location.href) {
        sendResponse({ ok: false, expectedKeys: [], actualKeys: [], message: "STALE_QUESTION_REVISION" });
        return false;
      }
      void (async () => {
        try {
          const verifyResult = deps.verifyParsedAnswerInPage(message.block as QuestionBlock, message.result as ParseResult, message.expectedUrl);
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
      // Legacy senders may omit the token, but an explicitly present,
      // malformed token must not silently downgrade to an untagged run.
      if (message.generationId !== undefined && !isProtectedWorkGenerationId(message.generationId)) {
        sendResponse({ ok: false, error: "INVALID_WORK_GENERATION" });
        return false;
      }
      if (deps.startAutoSolveAll(message.generationId) === false) {
        sendResponse({ ok: false, error: "WORK_ALREADY_RUNNING" });
        return false;
      }
      sendResponse({ ok: true });
      return false;

    case "STOP_AUTO_SOLVE_ALL":
      if (message.generationId !== undefined && !isProtectedWorkGenerationId(message.generationId)) {
        sendResponse({ ok: false, error: "INVALID_WORK_GENERATION" });
        return false;
      }
      if (deps.stopAutoSolveAll(message.generationId) === false) {
        sendResponse({ ok: false, error: "STALE_WORK_GENERATION" });
        return false;
      }
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
}
