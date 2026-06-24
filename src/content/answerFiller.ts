import type { BoundingBox, ParseResult, QuestionBlock } from "@/shared/types";
import { fillChoiceLikeAnswer as fillChoiceLikeAnswerCore, verifyChoiceAnswerInScope } from "./answerChoiceInteraction";
import {
  applyTextValue,
  clickElement,
  compareRectPosition,
  dispatchChoiceEvents,
  intersectionArea,
  isVisible,
  normalizeText,
  pause,
  rectIntersectsExpandedBBox,
  requestRealClick,
  setNativeChecked,
} from "./answerDomUtils";
import {
  collectTextControls,
  ensureQuestionRegionVisible,
  normalizeBBoxToViewport,
  relocateQuestionScopeByText,
  relocateQuestionScopeByTextSync,
  resolveDirectQuestionScope,
  resolveDirectQuestionScopeSync,
  resolveQuestionScope,
  shouldRelocateScope,
} from "./answerScope";
import {
  buildControlValues as buildControlValuesCore,
  formatSingleTextAnswer as formatSingleTextAnswerCore,
  inferTypeFromAnswer as inferTypeFromAnswerCore,
  normalizeChoiceAnswerKeys as normalizeChoiceAnswerKeysCore,
  resolveTextAnswerSource as resolveTextAnswerSourceCore,
  splitAnswerParts as splitAnswerPartsCore,
} from "./answerText";
import type { FillAnswerResult, VerifyAnswerResult } from "./answerTypes";

const TEXT_INPUT_SELECTOR = [
  "input:not([type='radio'])",
  "input:not([type='checkbox'])",
  "input:not([type='hidden'])",
  "input:not([type='button'])",
  "input:not([type='submit'])",
  "textarea",
  "[contenteditable='true']",
].join(",");

const CHOICE_INPUT_SELECTOR = "input[type='radio'],input[type='checkbox']";
const OPTION_ROW_SELECTOR = "li,label,div,p,span";

const choiceHelperDeps = {
  clickElement,
  compareRectPosition,
  dispatchChoiceEvents,
  intersectionArea,
  isVisible,
  normalizeText,
  pause,
  rectIntersectsExpandedBBox,
  requestRealClick,
  setNativeChecked,
};

const scopeSelectors = {
  textInputSelector: TEXT_INPUT_SELECTOR,
  choiceInputSelector: CHOICE_INPUT_SELECTOR,
};

export async function fillParsedAnswerInPage(block: QuestionBlock, result: ParseResult): Promise<FillAnswerResult> {
  const directScope = await resolveDirectQuestionScope(block, result);
  if (directScope) {
    const directPass = await fillAnswerIntoScope(directScope.scope, directScope.bbox, result);
    if (directPass.ok || !shouldRetryFillWithTextRelocation(directPass)) return directPass;
  }

  ensureQuestionRegionVisible(block.bbox);
  const viewportBbox = normalizeBBoxToViewport(block.bbox);
  let scope = resolveQuestionScope(viewportBbox, scopeSelectors);
  let effectiveBbox = viewportBbox;
  if (shouldRelocateScope(scope, block, result)) {
    const relocatedFirst = await relocateQuestionScopeByText(block, result);
    if (relocatedFirst) {
      scope = relocatedFirst.scope;
      effectiveBbox = relocatedFirst.bbox;
    }
  }

  const firstPass = await fillAnswerIntoScope(scope, effectiveBbox, result);
  if (firstPass.ok || !shouldRetryFillWithTextRelocation(firstPass)) return firstPass;

  const relocated = await relocateQuestionScopeByText(block, result);
  if (!relocated) return firstPass;
  return fillAnswerIntoScope(relocated.scope, relocated.bbox, result);
}

export function verifyParsedAnswerInPage(block: QuestionBlock, result: ParseResult): VerifyAnswerResult {
  const directScope = resolveDirectQuestionScopeSync(block, result);
  if (directScope) {
    const directPass = verifyAnswerInScope(directScope.scope, directScope.bbox, result);
    if (directPass.ok || !shouldRetryVerifyWithTextRelocation(directPass)) return directPass;
  }

  const viewportBbox = normalizeBBoxToViewport(block.bbox);
  let scope = resolveQuestionScope(viewportBbox, scopeSelectors);
  let effectiveBbox = viewportBbox;
  if (shouldRelocateScope(scope, block, result)) {
    const relocatedFirst = relocateQuestionScopeByTextSync(block, result);
    if (relocatedFirst) {
      scope = relocatedFirst.scope;
      effectiveBbox = relocatedFirst.bbox;
    }
  }

  const firstPass = verifyAnswerInScope(scope, effectiveBbox, result);
  if (firstPass.ok || !shouldRetryVerifyWithTextRelocation(firstPass)) return firstPass;

  const relocated = relocateQuestionScopeByTextSync(block, result);
  if (!relocated) return firstPass;
  return verifyAnswerInScope(relocated.scope, relocated.bbox, result);
}

export async function fillAnswerIntoScope(scope: Element, bbox: BoundingBox, result: ParseResult): Promise<FillAnswerResult> {
  const domInferredType = inferTypeFromAnswerCore(
    scope,
    result.answer,
    TEXT_INPUT_SELECTOR,
    CHOICE_INPUT_SELECTOR,
    OPTION_ROW_SELECTOR,
    normalizeText,
  );
  const effectiveType = resolveEffectiveQuestionType(result.questionType, domInferredType);

  if (effectiveType === "single_choice" || effectiveType === "multi_choice" || effectiveType === "judge") {
    return fillChoiceLikeAnswer(scope, bbox, result, effectiveType);
  }

  return fillTextLikeAnswer(scope, bbox, result, effectiveType);
}

export function verifyAnswerInScope(scope: Element, bbox: BoundingBox, result: ParseResult): VerifyAnswerResult {
  const domInferredType = inferTypeFromAnswerCore(
    scope,
    result.answer,
    TEXT_INPUT_SELECTOR,
    CHOICE_INPUT_SELECTOR,
    OPTION_ROW_SELECTOR,
    normalizeText,
  );
  const effectiveType = resolveEffectiveQuestionType(result.questionType, domInferredType);

  if (effectiveType !== "single_choice" && effectiveType !== "multi_choice" && effectiveType !== "judge") {
    return { ok: true, expectedKeys: [], actualKeys: [], message: "non-choice" };
  }

  return verifyChoiceAnswerInScope(scope, bbox, result, effectiveType, choiceHelperDeps);
}

export function splitAnswerParts(answer: string, expectedCount: number): string[] {
  return splitAnswerPartsCore(answer, expectedCount);
}

export function normalizeChoiceAnswerKeys(answer: string, questionType: ParseResult["questionType"]): string[] {
  return normalizeChoiceAnswerKeysCore(answer, questionType);
}

function resolveEffectiveQuestionType(
  parsedType: ParseResult["questionType"],
  domType: ParseResult["questionType"],
): ParseResult["questionType"] {
  if (parsedType === "unknown") return domType;
  if (domType === "unknown") return parsedType;

  const domIsChoice = domType === "single_choice" || domType === "multi_choice" || domType === "judge";
  const parsedIsText = parsedType === "fill_blank" || parsedType === "short_answer";
  if (domIsChoice && parsedIsText) return domType;

  return parsedType;
}

async function fillChoiceLikeAnswer(
  scope: Element,
  bbox: BoundingBox,
  result: ParseResult,
  questionType: ParseResult["questionType"],
): Promise<FillAnswerResult> {
  return fillChoiceLikeAnswerCore(scope, bbox, result, questionType, choiceHelperDeps);
}

function fillTextLikeAnswer(
  scope: Element,
  bbox: BoundingBox,
  result: ParseResult,
  questionType: ParseResult["questionType"],
): FillAnswerResult {
  const controls = collectTextControls(scope, bbox, TEXT_INPUT_SELECTOR);
  if (!controls.length) {
    return { ok: false, filledCount: 0, message: "鏈壘鍒版枃鏈緭鍏ユ" };
  }

  const answerSource = resolveTextAnswerSourceCore(result, controls.length, questionType);
  if (!answerSource) {
    return { ok: false, filledCount: 0, message: "绛旀闇€浜哄伐纭锛屾湭鑷姩濉啓" };
  }

  const parts = splitAnswerPartsCore(answerSource, controls.length);
  const values = controls.length === 1
    ? [formatSingleTextAnswerCore(answerSource, questionType)]
    : buildControlValuesCore(parts, controls.length, answerSource);

  let filledCount = 0;
  controls.forEach((control, index) => {
    const nextValue = values[index] ?? "";
    if (!nextValue) return;
    if (applyTextValue(control, nextValue)) filledCount += 1;
  });

  return filledCount > 0
    ? { ok: true, filledCount, message: `宸插～鍐?${filledCount} 涓緭鍏ユ` }
    : { ok: false, filledCount: 0, message: "鏈啓鍏ヤ换浣曡緭鍏ユ" };
}

function shouldRetryFillWithTextRelocation(result: FillAnswerResult): boolean {
  return /鏈壘鍒板彲濉啓鐨勯€夐」鎺т欢|鏈壘鍒版枃鏈緭鍏ユ|鏈啓鍏ヤ换浣曡緭鍏ユ/.test(String(result.message || ""));
}

function shouldRetryVerifyWithTextRelocation(result: VerifyAnswerResult): boolean {
  return /鏃犳硶鏄犲皠鏈熸湜閫夐」|鏈€変腑/.test(String(result.message || ""));
}
