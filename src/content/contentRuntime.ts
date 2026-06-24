import type { ExtMessage, ParseResult, QuestionBlock } from "@/shared/types";
import { detectCandidatesInViewport } from "./detector/domDetector";

export function isExtensionContextInvalidatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /Extension context invalidated/i.test(message);
}

export function safeRuntimeSendMessage(message: unknown): void {
  try {
    const maybePromise = chrome.runtime.sendMessage(message);
    if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
      void (maybePromise as Promise<unknown>).catch((err) => {
        if (isExtensionContextInvalidatedError(err)) return;
        console.warn("[RuntimeMessage] send failed:", err);
      });
    }
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return;
    console.warn("[RuntimeMessage] send failed:", err);
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: number | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(new Error(reason)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export function isElementDisabled(el: HTMLElement): boolean {
  if ("disabled" in el && typeof (el as HTMLButtonElement).disabled === "boolean") {
    if ((el as HTMLButtonElement).disabled) return true;
  }
  const ariaDisabled = el.getAttribute("aria-disabled");
  if (ariaDisabled === "true") return true;
  const cls = String(el.className || "");
  return /disabled|is-disabled/.test(cls);
}

export function triggerUiClick(target: HTMLElement) {
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  target.click();
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

export function pauseMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function findNextQuestionButton(
  normalizeQuestionText: (text: string) => string,
  isExtensionUiElement: (el: Element) => boolean,
  isElementVisible: (el: HTMLElement) => boolean,
): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll("button,a,span,div"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => !isExtensionUiElement(el))
    .filter((el) => isElementVisible(el))
    .filter((el) => /下一题|next/i.test(normalizeQuestionText(el.innerText || el.textContent || "")));

  const enabled = nodes.filter((el) => !isElementDisabled(el));
  const ranked = (enabled.length ? enabled : nodes).sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return br.top - ar.top || br.left - ar.left;
  });

  return ranked[0] ?? null;
}

export function clickNextQuestionButton(
  normalizeQuestionText: (text: string) => string,
  isExtensionUiElement: (el: Element) => boolean,
  isElementVisible: (el: HTMLElement) => boolean,
): boolean {
  const nextButton = findNextQuestionButton(normalizeQuestionText, isExtensionUiElement, isElementVisible);
  if (!nextButton || isElementDisabled(nextButton)) return false;
  triggerUiClick(nextButton);
  return true;
}

export async function waitForQuestionAdvance(
  previousFingerprint: string,
  previousOrder: number | null,
  options: {
    autoSolveStopRequested: () => boolean;
    pickLiveAutoSolveBlock: () => QuestionBlock | null;
    getAutoSolveFingerprint: (block: QuestionBlock) => string;
    extractAutoSolveQuestionOrder: (text: string) => number | null;
    timeoutMs?: number;
  },
): Promise<boolean> {
  const { autoSolveStopRequested, pickLiveAutoSolveBlock, getAutoSolveFingerprint, extractAutoSolveQuestionOrder, timeoutMs = 8000 } = options;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (autoSolveStopRequested()) return false;
    await pauseMs(350);
    const currentBlock = pickLiveAutoSolveBlock();
    if (!currentBlock) continue;
    const nextFingerprint = getAutoSolveFingerprint(currentBlock);
    const nextOrder = extractAutoSolveQuestionOrder(currentBlock.previewText || "");
    if (previousOrder !== null && nextOrder !== null && nextOrder !== previousOrder) return true;
    if (nextFingerprint && nextFingerprint !== previousFingerprint) return true;
  }
  return false;
}

export function sendAutoSolveProgress(
  payload: {
    running: boolean;
    solved: number;
    filled: number;
    total: number;
    current: number;
    statusText: string;
    currentQuestionId?: string;
    currentPreview?: string;
    currentBlock?: QuestionBlock;
  },
) {
  safeRuntimeSendMessage({
    type: "AUTO_SOLVE_PROGRESS",
    ...payload,
  });
}

export function sendAutoSolveDone(payload: {
  ok: boolean;
  stopped?: boolean;
  solved: number;
  filled: number;
  total: number;
  message: string;
}) {
  safeRuntimeSendMessage({
    type: "AUTO_SOLVE_DONE",
    ...payload,
  });
}

export async function sendToBackgroundWithTimeout<R>(message: ExtMessage, timeoutMs: number): Promise<R | null> {
  try {
    return await withTimeout(sendToBackground<R>(message), timeoutMs, "background_timeout");
  } catch {
    return null;
  }
}

function sendToBackground<R>(message: ExtMessage): Promise<R> {
  return chrome.runtime.sendMessage(message) as Promise<R>;
}

export function pickLiveAutoSolveBlock(
  detectZhihuishuCurrentQuestionBlock: () => QuestionBlock | null,
  pickAutoSolveBlock: (blocks: QuestionBlock[]) => QuestionBlock | null,
): QuestionBlock | null {
  return detectZhihuishuCurrentQuestionBlock() ?? pickAutoSolveBlock(detectCandidatesInViewport());
}

export function isChoiceLikeQuestionType(questionType: ParseResult["questionType"]): boolean {
  return questionType === "single_choice" || questionType === "multi_choice" || questionType === "judge";
}
