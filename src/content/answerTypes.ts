import type { BoundingBox } from "@/shared/types";

export interface FillAnswerResult {
  ok: boolean;
  filledCount: number;
  message: string;
  code?: FillAnswerCode;
}

/** Stable machine-readable result codes shared by page, Auto Solve, and Side Panel fills. */
export type FillAnswerCode =
  | "FILLED_VERIFIED"
  | "NO_CHANGE_NEEDED"
  | "CONTROL_MAPPING_AMBIGUOUS"
  | "CONTROL_MAPPING_CHANGED"
  | "CONTROL_NOT_FOUND"
  | "CONTROL_COUNT_MISMATCH"
  | "STALE_ACTION_PLAN"
  | "STALE_QUESTION_REVISION"
  | "STALE_ROOT_CONTEXT"
  | "STALE_RUNTIME_QUESTION_HANDLE"
  | "USER_STATE_SNAPSHOT_UNAVAILABLE"
  | "USER_STATE_CHANGED"
  | "FILL_VERIFICATION_FAILED"
  | "ROLLBACK_FAILED"
  | "ROLLBACK_AUTHORITY_LOST"
  | "PARTIAL_MUTATION_UNPROVABLE"
  | "UNSUPPORTED_CONTROL"
  | "INVALID_ANSWER"
  | "INVALID_ANSWER_OPTION"
  | "INVALID_SINGLE_CHOICE_CARDINALITY"
  | "ANSWER_BLANK_COUNT_MISMATCH"
  | "UNSUPPORTED_QUESTION_TYPE";

export interface VerifyAnswerResult {
  ok: boolean;
  expectedKeys: string[];
  actualKeys: string[];
  message: string;
}

export interface ChoiceHelperDeps {
  clickElement(target: HTMLElement): void;
  compareRectPosition(a: DOMRect, b: DOMRect): number;
  dispatchChoiceEvents(target: HTMLInputElement): void;
  intersectionArea(rect: DOMRect, bbox: BoundingBox): number;
  isVisible(el: HTMLElement): boolean;
  normalizeText(text: string): string;
  pause(ms: number): Promise<void>;
  rectIntersectsExpandedBBox(rect: DOMRect, bbox: BoundingBox, verticalPad: number, horizontalPad: number): boolean;
  requestRealClick(target: HTMLElement): Promise<boolean>;
  setNativeChecked(input: HTMLInputElement, checked: boolean): void;
}
