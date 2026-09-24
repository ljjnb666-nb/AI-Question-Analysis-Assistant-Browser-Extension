export type ActionStep =
  | { type: "select-option"; optionKey: string; desiredSelected: true }
  | { type: "clear-option"; optionKey: string; desiredSelected: false }
  | { type: "set-text"; value: string; blankIndex?: number }
  | { type: "clear-text"; blankIndex?: number };

export interface ActionPlan {
  schemaVersion: 1;
  questionId: string;
  contentFingerprint: string;
  answerSemanticHash: string;
  steps: ActionStep[];
}
