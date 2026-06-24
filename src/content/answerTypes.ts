import type { BoundingBox } from "@/shared/types";

export interface FillAnswerResult {
  ok: boolean;
  filledCount: number;
  message: string;
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
