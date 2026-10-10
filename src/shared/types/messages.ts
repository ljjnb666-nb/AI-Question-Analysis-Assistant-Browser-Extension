import type { AppSettingsCommand } from "./appSettingsMessages";
import type { AIConnectionCommand } from "./aiConnectionMessages";
import type { BoundingBox } from "./capture";
import type { ParseResult } from "./parse";
import type { QuestionBlock } from "./question";
import type { AppSettings } from "./settings";
import type { CandidateSnapshot, FloatingWindowState } from "./ui";
import type { CandidateWorkspaceSnapshot } from "./workspace";

export type MessageType =
  | AppSettingsCommand["type"]
  | AIConnectionCommand["type"]
  | "GET_CANDIDATE_WORKSPACE_SNAPSHOT"
  | "CANDIDATE_WORKSPACE_UPDATED"
  | "START_MANUAL_CAPTURE"
  | "CANCEL_MANUAL_CAPTURE"
  | "SUBMIT_MANUAL_CAPTURE"
  | "START_AUTO_DETECT"
  | "AUTO_DETECT_RESULT_READY"
  | "OPEN_FLOATING_RESULT"
  | "UPDATE_FLOATING_RESULT"
  | "CLOSE_FLOATING_RESULT"
  | "MINIMIZE_FLOATING_RESULT"
  | "OPEN_SIDEPANEL"
  | "SUBMIT_BATCH_PARSE"
  | "PARSE_RESULT_READY"
  | "PARSE_RESULT_ERROR"
  | "SAVE_WINDOW_STATE"
  | "LOAD_WINDOW_STATE"
  | "CAPTURE_TAB_SCREENSHOT"
  | "TAB_SCREENSHOT_READY"
  | "HIGHLIGHT_CANDIDATE"
  | "UPDATE_CANDIDATE_SELECTION"
  | "CLEAR_HIGHLIGHTS"
  | "GET_SETTINGS"
  | "SAVE_SETTINGS"
  | "LOG_EVENT"
  | "START_FULL_PAGE_DETECT"
  | "FULL_PAGE_DETECT_PROGRESS"
  | "FULL_PAGE_DETECT_DONE"
  | "FULL_PAGE_DETECT_CANCELLED"
  | "CAPTURE_BLOCK_IMAGE"
  | "VALIDATE_QUESTION_RESULT_AUTHORITY"
  | "FILL_PARSED_ANSWER"
  | "VERIFY_PARSED_ANSWER"
  | "START_AUTO_SOLVE_ALL"
  | "STOP_AUTO_SOLVE_ALL"
  | "AUTO_SOLVE_PROGRESS"
  | "AUTO_SOLVE_DONE";

export interface BaseMessage {
  type: MessageType;
}

export interface StartManualCaptureMsg extends BaseMessage {
  type: "START_MANUAL_CAPTURE";
}

export interface CancelManualCaptureMsg extends BaseMessage {
  type: "CANCEL_MANUAL_CAPTURE";
}

export interface SubmitManualCaptureMsg extends BaseMessage {
  type: "SUBMIT_MANUAL_CAPTURE";
  bbox: BoundingBox;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}

export interface CaptureTabScreenshotMsg extends BaseMessage {
  type: "CAPTURE_TAB_SCREENSHOT";
}

export interface TabScreenshotReadyMsg extends BaseMessage {
  type: "TAB_SCREENSHOT_READY";
  dataUrl: string;
}

export interface OpenFloatingResultMsg extends BaseMessage {
  type: "OPEN_FLOATING_RESULT";
  block: QuestionBlock;
  result?: ParseResult;
}

export interface UpdateFloatingResultMsg extends BaseMessage {
  type: "UPDATE_FLOATING_RESULT";
  result: ParseResult;
}

export interface CloseFloatingResultMsg extends BaseMessage {
  type: "CLOSE_FLOATING_RESULT";
}

export interface MinimizeFloatingResultMsg extends BaseMessage {
  type: "MINIMIZE_FLOATING_RESULT";
  minimized: boolean;
}

export interface ParseResultReadyMsg extends BaseMessage {
  type: "PARSE_RESULT_READY";
  result: ParseResult;
}

export interface ParseResultErrorMsg extends BaseMessage {
  type: "PARSE_RESULT_ERROR";
  blockId: string;
  error: string;
}

export interface SaveWindowStateMsg extends BaseMessage {
  type: "SAVE_WINDOW_STATE";
  state: Partial<FloatingWindowState>;
}

export interface StartAutoDetectMsg extends BaseMessage {
  type: "START_AUTO_DETECT";
  /** Optional, generation-bound Side Panel command. Legacy callers omit both fields. */
  requestId?: string;
  expectedUrl?: string;
}

export interface AutoDetectResultReadyMsg extends BaseMessage {
  type: "AUTO_DETECT_RESULT_READY";
  candidates: CandidateSnapshot[];
}

export interface HighlightCandidateMsg extends BaseMessage {
  type: "HIGHLIGHT_CANDIDATE";
  blockId: string;
}

export interface UpdateCandidateSelectionMsg extends BaseMessage {
  type: "UPDATE_CANDIDATE_SELECTION";
  blockId?: string;
  selected?: boolean;
  selectAll?: boolean;
}

export interface ClearHighlightsMsg extends BaseMessage {
  type: "CLEAR_HIGHLIGHTS";
}

export interface SubmitBatchParseMsg extends BaseMessage {
  type: "SUBMIT_BATCH_PARSE";
  blocks: QuestionBlock[];
}

export interface GetSettingsMsg extends BaseMessage {
  type: "GET_SETTINGS";
}

export interface SaveSettingsMsg extends BaseMessage {
  type: "SAVE_SETTINGS";
  settings: Partial<AppSettings>;
}

export interface LogEventMsg extends BaseMessage {
  type: "LOG_EVENT";
  event: string;
  data?: Record<string, unknown>;
}

export interface StartFullPageDetectMsg extends BaseMessage {
  type: "START_FULL_PAGE_DETECT";
  /** Persisted owner run identity; absent for legacy callers. */
  generationId?: string;
}

export interface FullPageDetectProgressMsg extends BaseMessage {
  type: "FULL_PAGE_DETECT_PROGRESS";
  observedCandidates?: number;
  retainedCandidates?: number;
  /** Immutable run identity of corresponding START. */
  generationId?: string;
  progress: number;
  found: number;
  totalScrollSteps: number;
  currentStep: number;
}

export type FullPageDetectOutcome = "completed" | "no_candidates" | "refinement_empty" | "failed";
export type FullPageDetectFailureStage = "scanning" | "refining" | "publishing";
export interface FullPageDetectDiagnostics {
  observedCandidates: number;
  retainedCandidates: number;
  postprocessedCandidates: number;
  refinedCandidates: number;
}

export interface FullPageDetectDoneMsg extends BaseMessage {
  type: "FULL_PAGE_DETECT_DONE";
  outcome?: FullPageDetectOutcome;
  failureStage?: FullPageDetectFailureStage;
  diagnostics?: FullPageDetectDiagnostics;
  /** Run generation for exact owner cleanup; omitted by legacy content scripts. */
  generationId?: string;
  candidates: QuestionBlock[];
  totalFound: number;
}

export interface FullPageDetectCancelledMsg extends BaseMessage {
  type: "FULL_PAGE_DETECT_CANCELLED";
  /** Exact work generation to cancel; absent only for legacy runs. */
  generationId?: string;
}

export interface CaptureBlockImageMsg extends BaseMessage {
  type: "CAPTURE_BLOCK_IMAGE";
  bbox: BoundingBox;
}

export interface ValidateQuestionResultAuthorityMsg extends BaseMessage {
  type: "VALIDATE_QUESTION_RESULT_AUTHORITY";
  block: QuestionBlock;
  expectedUrl: string;
}

export interface FillParsedAnswerMsg extends BaseMessage {
  type: "FILL_PARSED_ANSWER";
  block: QuestionBlock;
  result: ParseResult;
  /** Origin URL captured with the Side Panel candidate; optional for internal/manual callers. */
  expectedUrl?: string;
}

export interface VerifyParsedAnswerMsg extends BaseMessage {
  type: "VERIFY_PARSED_ANSWER";
  block: QuestionBlock;
  result: ParseResult;
  expectedUrl: string;
}

export interface StartAutoSolveAllMsg extends BaseMessage {
  type: "START_AUTO_SOLVE_ALL";
  /** Owner generation committed before START. Undefined for legacy senders. */
  generationId?: string;
}

export interface StopAutoSolveAllMsg extends BaseMessage {
  type: "STOP_AUTO_SOLVE_ALL";
  /** Exact work generation to stop; absent only for legacy runs. */
  generationId?: string;
}

export interface AutoSolveProgressMsg extends BaseMessage {
  type: "AUTO_SOLVE_PROGRESS";
  /** Corresponding START owner generation for progress correlation. */
  generationId?: string;
  running: boolean;
  solved: number;
  filled: number;
  total: number;
  current: number;
  /** Legacy debug/compat text; the Side Panel localizes from statusCode. */
  statusText: string;
  /** UI-00B: stable status code; the Side Panel owns the user-visible copy. */
  statusCode?: string;
  /** Stable sub-code behind the status (e.g. a fill result code). */
  statusDetail?: string;
  currentQuestionId?: string;
  currentPreview?: string;
  currentBlock?: QuestionBlock;
}

export interface AutoSolveDoneMsg extends BaseMessage {
  type: "AUTO_SOLVE_DONE";
  /** Run generation for exact owner cleanup; omitted by legacy content scripts. */
  generationId?: string;
  ok: boolean;
  stopped?: boolean;
  solved: number;
  filled: number;
  total: number;
  /** Legacy debug/compat text; the Side Panel localizes from ok/stopped. */
  message: string;
}

export type ExtMessage =
  | AppSettingsCommand
  | AIConnectionCommand
  | { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT"; expectedUrl: string }
  | { type: "CANDIDATE_WORKSPACE_UPDATED"; snapshot: CandidateWorkspaceSnapshot }
  | StartManualCaptureMsg
  | CancelManualCaptureMsg
  | SubmitManualCaptureMsg
  | CaptureTabScreenshotMsg
  | TabScreenshotReadyMsg
  | OpenFloatingResultMsg
  | UpdateFloatingResultMsg
  | CloseFloatingResultMsg
  | MinimizeFloatingResultMsg
  | ParseResultReadyMsg
  | ParseResultErrorMsg
  | SaveWindowStateMsg
  | StartAutoDetectMsg
  | AutoDetectResultReadyMsg
  | HighlightCandidateMsg
  | UpdateCandidateSelectionMsg
  | ClearHighlightsMsg
  | SubmitBatchParseMsg
  | GetSettingsMsg
  | SaveSettingsMsg
  | LogEventMsg
  | StartFullPageDetectMsg
  | FullPageDetectProgressMsg
  | FullPageDetectDoneMsg
  | FullPageDetectCancelledMsg
  | CaptureBlockImageMsg
  | ValidateQuestionResultAuthorityMsg
  | FillParsedAnswerMsg
  | VerifyParsedAnswerMsg
  | StartAutoSolveAllMsg
  | StopAutoSolveAllMsg
  | AutoSolveProgressMsg
  | AutoSolveDoneMsg;
