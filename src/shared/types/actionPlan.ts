export type ActionStep =
  | { type: "select-option"; controlId: string; optionKey: string; desiredSelected: true }
  | { type: "clear-option"; controlId: string; optionKey: string; desiredSelected: false }
  | { type: "set-text"; controlId: string; value: string; blankIndex?: number }
  | { type: "clear-text"; controlId: string };

export interface ActionPlan {
  schemaVersion: 1;
  questionId: string;
  contentFingerprint: string;
  answerSemanticHash: string;
  steps: ActionStep[];
}
