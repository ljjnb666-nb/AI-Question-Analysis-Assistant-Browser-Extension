// ─── Capture ────────────────────────────────────────────────────────────────

export type CaptureMode = "manual" | "auto_visible" | "auto_full";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Question ────────────────────────────────────────────────────────────────

export type QuestionType =
  | "single_choice"
  | "multi_choice"
  | "judge"
  | "fill_blank"
  | "short_answer"
  | "unknown";

export type QuestionSource = "manual_capture" | "auto_dom" | "auto_visual";

export type QuestionDisplaySegment =
  | { type: "text"; text: string }
  | { type: "image"; url: string };

export interface QuestionBlock {
  id: string;
  bbox: BoundingBox;
  previewText: string;
  displaySegments?: QuestionDisplaySegment[];
  hasImage: boolean;
  questionImageUrl?: string;
  questionTypeGuess: QuestionType;
  confidence: number;
  source: QuestionSource;
  imageDataUrl?: string;
}

// ─── Parse Result ─────────────────────────────────────────────────────────────

export type RouteUsed = "text" | "vision" | "hybrid";
export type ParseStatus = "idle" | "loading" | "success" | "error";
export type ChoiceSelectionMap = Partial<Record<"A" | "B" | "C" | "D" | "E" | "F", boolean | null>>;

export interface ParseResult {
  blockId: string;
  questionType: QuestionType;
  answer: string;
  confidence: number;
  briefExplanation: string;
  detailedExplanation: string;
  recognizedText: string;
  routeUsed: RouteUsed;
  optionSelections?: ChoiceSelectionMap;
  ocrQualityScore?: number;
  warning?: string;
}

// ─── History ──────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  timestamp: number;
  block: QuestionBlock;
  result: ParseResult;
  host: string;
}

// ─── Auto-detect candidate ────────────────────────────────────────────────────

export interface DetectedCandidate {
  block: QuestionBlock;
  selected: boolean;
  status: ParseStatus;
  result?: ParseResult;
  error?: string;
  debugInfo?: {
    imageAttached?: boolean;
    routeUsed?: RouteUsed;
  };
}

export interface CandidateSnapshot {
  block: QuestionBlock;
  selected: boolean;
  status: ParseStatus;
}

// ─── Floating Window ─────────────────────────────────────────────────────────

export interface FloatingWindowState {
  visible: boolean;
  minimized: boolean;
  loading: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export function getDefaultFloatingState(): FloatingWindowState {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  return {
    visible: false,
    minimized: false,
    loading: false,
    x: vw - 420,
    y: vh - 320,
    width: 380,
    height: 280,
    zIndex: 2147483640,
  };
}

export const DEFAULT_FLOATING_STATE: FloatingWindowState = {
  visible: false,
  minimized: false,
  loading: false,
  x: 860,
  y: 480,
  width: 380,
  height: 280,
  zIndex: 2147483640,
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  providerId: string;
  apiKey: string;
  apiModel: string;
  preferredRoute: "auto" | "text" | "vision";
  language: "zh" | "en";
  enableAnalytics: boolean;
  customBaseUrl?: string;
  customProviderProtocol?: "openai" | "anthropic";
}

export const DEFAULT_SETTINGS: AppSettings = {
  providerId: "anthropic",
  apiKey: "",
  apiModel: "claude-opus-4-5",
  preferredRoute: "auto",
  language: "zh",
  enableAnalytics: true,
  customProviderProtocol: "openai",
};

// ─── Messages ─────────────────────────────────────────────────────────────────

export type MessageType =
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
  | "FILL_PARSED_ANSWER"
  | "VERIFY_PARSED_ANSWER"
  | "REAL_CLICK"
  | "START_AUTO_SOLVE_ALL"
  | "STOP_AUTO_SOLVE_ALL"
  | "AUTO_SOLVE_PROGRESS"
  | "AUTO_SOLVE_DONE";

export interface BaseMessage { type: MessageType; }

export interface StartManualCaptureMsg extends BaseMessage { type: "START_MANUAL_CAPTURE"; }
export interface CancelManualCaptureMsg extends BaseMessage { type: "CANCEL_MANUAL_CAPTURE"; }
export interface SubmitManualCaptureMsg extends BaseMessage {
  type: "SUBMIT_MANUAL_CAPTURE";
  bbox: BoundingBox;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}
export interface CaptureTabScreenshotMsg extends BaseMessage { type: "CAPTURE_TAB_SCREENSHOT"; }
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
export interface CloseFloatingResultMsg extends BaseMessage { type: "CLOSE_FLOATING_RESULT"; }
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
export interface StartAutoDetectMsg extends BaseMessage { type: "START_AUTO_DETECT"; }
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
export interface ClearHighlightsMsg extends BaseMessage { type: "CLEAR_HIGHLIGHTS"; }
export interface SubmitBatchParseMsg extends BaseMessage {
  type: "SUBMIT_BATCH_PARSE";
  blocks: QuestionBlock[];
}
export interface GetSettingsMsg extends BaseMessage { type: "GET_SETTINGS"; }
export interface SaveSettingsMsg extends BaseMessage {
  type: "SAVE_SETTINGS";
  settings: Partial<AppSettings>;
}
export interface LogEventMsg extends BaseMessage {
  type: "LOG_EVENT";
  event: string;
  data?: Record<string, unknown>;
}

export interface StartFullPageDetectMsg extends BaseMessage { type: "START_FULL_PAGE_DETECT"; }
export interface FullPageDetectProgressMsg extends BaseMessage {
  type: "FULL_PAGE_DETECT_PROGRESS";
  /** 0–100 */
  progress: number;
  found: number;
  totalScrollSteps: number;
  currentStep: number;
}
export interface FullPageDetectDoneMsg extends BaseMessage {
  type: "FULL_PAGE_DETECT_DONE";
  candidates: QuestionBlock[];
  totalFound: number;
}
export interface FullPageDetectCancelledMsg extends BaseMessage { type: "FULL_PAGE_DETECT_CANCELLED"; }
export interface CaptureBlockImageMsg extends BaseMessage {
  type: "CAPTURE_BLOCK_IMAGE";
  bbox: BoundingBox;
}
export interface FillParsedAnswerMsg extends BaseMessage {
  type: "FILL_PARSED_ANSWER";
  block: QuestionBlock;
  result: ParseResult;
}
export interface VerifyParsedAnswerMsg extends BaseMessage {
  type: "VERIFY_PARSED_ANSWER";
  block: QuestionBlock;
  result: ParseResult;
}
export interface RealClickMsg extends BaseMessage {
  type: "REAL_CLICK";
  x: number;
  y: number;
}
export interface StartAutoSolveAllMsg extends BaseMessage { type: "START_AUTO_SOLVE_ALL"; }
export interface StopAutoSolveAllMsg extends BaseMessage { type: "STOP_AUTO_SOLVE_ALL"; }
export interface AutoSolveProgressMsg extends BaseMessage {
  type: "AUTO_SOLVE_PROGRESS";
  running: boolean;
  solved: number;
  filled: number;
  total: number;
  current: number;
  statusText: string;
  currentQuestionId?: string;
  currentPreview?: string;
  currentBlock?: QuestionBlock;
}
export interface AutoSolveDoneMsg extends BaseMessage {
  type: "AUTO_SOLVE_DONE";
  ok: boolean;
  stopped?: boolean;
  solved: number;
  filled: number;
  total: number;
  message: string;
}

export type ExtMessage =
  | StartManualCaptureMsg | CancelManualCaptureMsg | SubmitManualCaptureMsg
  | CaptureTabScreenshotMsg | TabScreenshotReadyMsg
  | OpenFloatingResultMsg | UpdateFloatingResultMsg
  | CloseFloatingResultMsg | MinimizeFloatingResultMsg
  | ParseResultReadyMsg | ParseResultErrorMsg | SaveWindowStateMsg
  | StartAutoDetectMsg | AutoDetectResultReadyMsg
  | HighlightCandidateMsg | UpdateCandidateSelectionMsg | ClearHighlightsMsg | SubmitBatchParseMsg
  | GetSettingsMsg | SaveSettingsMsg | LogEventMsg
  | StartFullPageDetectMsg | FullPageDetectProgressMsg
  | FullPageDetectDoneMsg | FullPageDetectCancelledMsg | CaptureBlockImageMsg | FillParsedAnswerMsg | VerifyParsedAnswerMsg | RealClickMsg
  | StartAutoSolveAllMsg | StopAutoSolveAllMsg | AutoSolveProgressMsg | AutoSolveDoneMsg;
