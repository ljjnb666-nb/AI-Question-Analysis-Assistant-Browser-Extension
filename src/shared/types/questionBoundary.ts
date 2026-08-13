export type QuestionBoundaryState = "complete" | "partial-top" | "partial-bottom" | "partial-both" | "fragment" | "ambiguous";

export type OwnershipRelation = "same-question" | "different-question" | "unknown";

export type OwnershipReason =
  | "same-native-id" | "different-native-id" | "same-ordinal" | "different-ordinal"
  | "new-question-marker" | "complete-options-before-new-stem" | "option-continuation"
  | "same-owner-container" | "different-owner-container" | "semantic-stem-start"
  | "partial-top" | "partial-bottom" | "geometry-adjacent" | "geometry-separated" | "conflicting-evidence";

export interface QuestionOwnershipDecision {
  relation: OwnershipRelation;
  confidence: number;
  reasons: OwnershipReason[];
}

export interface QuestionBoundaryInfo {
  state: QuestionBoundaryState;
  clippedTop: boolean;
  clippedBottom: boolean;
  confidence: number;
  reasons: string[];
}

export type QuestionCompletenessState = "complete" | "incomplete" | "unknown";

export interface QuestionCompleteness {
  state: QuestionCompletenessState;
  boundaryComplete: boolean | "unknown";
  stemComplete: boolean | "unknown";
  optionsComplete: boolean | "unknown";
  visualComplete: boolean | "unknown";
  controlsComplete: boolean | "unknown";
  confidence: number;
  reasons: string[];
}
