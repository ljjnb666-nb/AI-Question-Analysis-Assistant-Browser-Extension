import type { QuestionBlock, QuestionType } from "./question";

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

export interface HistoryEntry {
  id: string;
  timestamp: number;
  block: QuestionBlock;
  result: ParseResult;
  host: string;
}
