import type { QuestionBlock, QuestionType } from "./question";

export type RouteUsed = "text" | "vision" | "hybrid";
export type ParseStatus = "idle" | "loading" | "success" | "error";
export type ChoiceSelectionMap = Partial<Record<"A" | "B" | "C" | "D" | "E" | "F", boolean | null>>;

/**
 * Verifiable provenance of a ParseResult (UI-00A):
 * - "provider": this result was produced by a real provider execution.
 * - "mock": this result came from the demo/mock generator.
 * - undefined: legacy persisted result whose origin cannot be proven.
 * The field must stay optional so old chrome.storage history stays readable;
 * unproven results simply never gain Fill authority.
 */
export type ParseResultSource = "provider" | "mock";

/**
 * Display-only structure derived from explicit labels in vision-model text.
 * NOT independent proof of image pixels and never a Fill authorization.
 * Optional to keep old parse history backwards compatible.
 */
export type ManualChoiceStructure = {
  version: 1;
  evidence: "vision_text_labels_unverified";
  stem: string;
  options: Array<{ key: "A" | "B" | "C" | "D"; text: string }>;
};

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
  structuredChoice?: ManualChoiceStructure;
  ocrQualityScore?: number;
  warning?: string;
  resultSource?: ParseResultSource;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  block: QuestionBlock;
  result: ParseResult;
  host: string;
}
