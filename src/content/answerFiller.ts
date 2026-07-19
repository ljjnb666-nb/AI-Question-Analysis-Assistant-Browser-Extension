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
const CODE_EDITOR_SELECTOR = ".cm-content[contenteditable='true'], .monaco-editor [contenteditable='true']";

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
    const fallback = tryFillCodeEditor(result, questionType);
    if (fallback) return fallback;
    return { ok: false, filledCount: 0, message: "未找到文本输入框" };
  }

  const answerSource = resolveTextAnswerSourceCore(result, controls.length, questionType);
  if (!answerSource) {
    return { ok: false, filledCount: 0, message: "答案需人工确认，未自动填写" };
  }

  const parts = splitAnswerPartsCore(answerSource, controls.length);
  const values = controls.length === 1
    ? [normalizeTextLikeAnswerForControl(formatSingleTextAnswerCore(answerSource, questionType), questionType)]
    : buildControlValuesCore(parts, controls.length, answerSource);

  let filledCount = 0;
  controls.forEach((control, index) => {
    const nextValue = values[index] ?? "";
    if (!nextValue) return;
    if (applyTextValue(control, nextValue)) filledCount += 1;
  });

  return filledCount > 0
    ? { ok: true, filledCount, message: `已填入 ${filledCount} 个输入框` }
    : { ok: false, filledCount: 0, message: "未写入任何输入框" };
}

function tryFillCodeEditor(
  result: ParseResult,
  questionType: ParseResult["questionType"],
): FillAnswerResult | null {
  if (!looksLikeCodeAnswer(result.answer, questionType)) return null;

  const editor = findBestCodeEditor();
  if (!editor) return null;

  const nextValue = normalizeCodeForEditor(formatSingleTextAnswerCore(result.answer, "short_answer"));
  if (!nextValue) {
    return { ok: false, filledCount: 0, message: "答案为空，无法填写代码" };
  }

  const changed = applyTextValue(editor, nextValue);
  return changed
    ? { ok: true, filledCount: 1, message: "已填入 1 个代码编辑器" }
    : { ok: false, filledCount: 0, message: "代码编辑器内容未发生变化" };
}

function findBestCodeEditor(): HTMLElement | null {
  const editors = Array.from(document.querySelectorAll(CODE_EDITOR_SELECTOR))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((node) => isVisible(node) && node.isContentEditable);
  if (!editors.length) return null;

  return editors
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .filter((entry) => entry.rect.width > 10 && entry.rect.height > 10)
    .sort((a, b) => {
      const ax = a.rect.left + a.rect.width / 2;
      const bx = b.rect.left + b.rect.width / 2;
      return bx - ax || b.rect.height - a.rect.height;
    })[0]?.node ?? null;
}

function looksLikeCodeAnswer(answer: string, questionType: ParseResult["questionType"]): boolean {
  if (questionType !== "short_answer") return false;
  const text = String(answer || "").trim();
  if (!text || /需人工确认/.test(text)) return false;
  return /#include|int\s+\*?\s*[A-Za-z_]\w*\s*\(|char\s+\*?\s*[A-Za-z_]\w*\s*\(|void\s+[A-Za-z_]\w*\s*\(|return\s+|for\s*\(|while\s*\(|if\s*\(|\{[\s\S]*\}/.test(text);
}

function normalizeCodeForEditor(code: string): string {
  const source = String(code || "").replace(/\r\n?/g, "\n");
  if (!source) return "";

  let out = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of source) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out += ch;
      continue;
    }

    if (ch === "\"" && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    if (ch === "\n" && (inSingle || inDouble)) {
      out += "\\n";
      continue;
    }

    out += ch;
  }

  return out;
}

function normalizeTextLikeAnswerForControl(answer: string, questionType: ParseResult["questionType"]): string {
  if (!looksLikeCodeAnswer(answer, questionType)) return answer;
  return normalizeCodeForEditor(answer);
}

function shouldRetryFillWithTextRelocation(result: FillAnswerResult): boolean {
  return /未找到可填写的选项控件|未找到文本输入框|未写入任何输入框/.test(String(result.message || ""));
}

function shouldRetryVerifyWithTextRelocation(result: VerifyAnswerResult): boolean {
  return /无法映射期望选项|未选中/.test(String(result.message || ""));
}
