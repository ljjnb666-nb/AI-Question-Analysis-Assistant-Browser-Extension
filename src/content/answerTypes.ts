import type { AnswerPlanFailureCode, BoundingBox } from "@/shared/types";
import type { FillOutcome } from "./answer/transactionalExecutor";

export interface FillAnswerResult {
  ok: boolean;
  filledCount: number;
  message: string;
  code?: FillOutcome | AnswerPlanFailureCode | "CONTROL_MAPPING_AMBIGUOUS" | "CONTROL_NOT_FOUND" | "CONTROL_COUNT_MISMATCH" | "STALE_RUNTIME_QUESTION_HANDLE" | "STALE_ROOT_CONTEXT" | "STALE_QUESTION_REVISION";
  stopAutomation?: boolean;
  rolledBack?: boolean;
}

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
