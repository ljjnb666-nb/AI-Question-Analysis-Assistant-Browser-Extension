import type { BoundingBox } from "./capture";
import type { QuestionIdentity } from "./questionV2";
import type { QuestionBoundaryInfo, QuestionCompleteness } from "./questionBoundary";

export type QuestionType =
  | "single_choice"
  | "multi_choice"
  | "judge"
  | "fill_blank"
  | "short_answer"
  | "unknown";

export type QuestionSource = "manual_capture" | "auto_dom" | "auto_visual";

export type QuestionDisplaySegment =
  | { type: "text"; text: string; role?: "title" | "meta" | "section"; label?: string }
  | { type: "image"; url: string };

export interface QuestionBlock {
  /** Runtime observation id. It is intentionally not a stable question identity. */
  id: string;
  /** Optional during migration so legacy chrome.storage records remain readable. */
  identity?: QuestionIdentity;
  /** Optional so persisted Phase 0/1 records remain readable. */
  boundary?: QuestionBoundaryInfo;
  /** Optional so manual capture preserves legacy behavior. */
  completeness?: QuestionCompleteness;
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
