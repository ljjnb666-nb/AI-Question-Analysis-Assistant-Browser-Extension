import type { BoundingBox, ParseResult, QuestionBlock } from "@/shared/types";

export interface FillAnswerResult {
  ok: boolean;
  filledCount: number;
  message: string;
}

interface ChoiceCandidate {
  key: string;
  input: HTMLInputElement | null;
  target: HTMLElement;
  score: number;
}

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
const JUDGE_TRUE_KEYS = ["对", "正确", "true", "t", "yes", "y"];
const JUDGE_FALSE_KEYS = ["错", "错误", "false", "f", "no", "n"];
const UNSAFE_TEXT_ANSWER_MARKERS = ["见分点答案", "示例答案", "需人工确认"];

export function fillParsedAnswerInPage(block: QuestionBlock, result: ParseResult): FillAnswerResult {
  const scope = resolveQuestionScope(block.bbox);
  return fillAnswerIntoScope(scope, block.bbox, result);
}

export function fillAnswerIntoScope(scope: Element, bbox: BoundingBox, result: ParseResult): FillAnswerResult {
  const effectiveType = result.questionType === "unknown"
    ? inferTypeFromAnswer(scope, result.answer)
    : result.questionType;

  if (effectiveType === "single_choice" || effectiveType === "multi_choice" || effectiveType === "judge") {
    return fillChoiceLikeAnswer(scope, bbox, result, effectiveType);
  }

  return fillTextLikeAnswer(scope, bbox, result, effectiveType);
}

export function splitAnswerParts(answer: string, expectedCount: number): string[] {
  const normalized = String(answer || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const numberedMatches = Array.from(
    normalized.matchAll(
      /(?:^|[\n;；])\s*(?:(\d+\.\d+)\s*[:：]?|\(?(\d+)\)?[.)、]\s*|第\s*(\d+)\s*空\s*[:：]?)\s*([^\n;；]+)/g,
    ),
  );
  if (numberedMatches.length >= Math.min(expectedCount, 2)) {
    return numberedMatches
      .map((match) => normalizeFilledPart(cleanAnswerPart(match[4] || "")))
      .filter(Boolean);
  }

  const labeledMatches = Array.from(
    normalized.matchAll(/(?:^|[\n;；])\s*(?:答案?\s*\d+|空\s*\d+|\d+\.\d+)\s*[:：]?\s*([^\n;；]+)/g),
  );
  if (labeledMatches.length >= Math.min(expectedCount, 2)) {
    return labeledMatches
      .map((match) => normalizeFilledPart(cleanAnswerPart(match[1] || "")))
      .filter(Boolean);
  }

  const segments = normalized
    .split(/[\n;；]+/)
    .map((part) => normalizeFilledPart(cleanAnswerPart(part)))
    .filter(Boolean);

  if (segments.length >= expectedCount && expectedCount > 1) {
    return segments.slice(0, expectedCount);
  }

  return segments.length > 0 ? segments : [normalizeFilledPart(cleanAnswerPart(normalized))].filter(Boolean);
}

export function normalizeChoiceAnswerKeys(answer: string, questionType: ParseResult["questionType"]): string[] {
  const raw = String(answer || "").trim();
  if (!raw) return [];

  if (questionType === "judge") {
    const normalized = raw.toLowerCase();
    if (JUDGE_TRUE_KEYS.some((key) => normalized.includes(key))) return ["对"];
    if (JUDGE_FALSE_KEYS.some((key) => normalized.includes(key))) return ["错"];
    return [];
  }

  const letters = raw.toUpperCase().match(/[A-Z]/g) || [];
  return Array.from(new Set(letters.filter((letter) => letter >= "A" && letter <= "F"))).sort();
}

function fillChoiceLikeAnswer(
  scope: Element,
  bbox: BoundingBox,
  result: ParseResult,
  questionType: ParseResult["questionType"],
): FillAnswerResult {
  const desiredKeys = normalizeChoiceAnswerKeys(result.answer, questionType);
  if (!desiredKeys.length) {
    return { ok: false, filledCount: 0, message: "答案格式无法映射到选项" };
  }

  const candidates = collectChoiceCandidates(scope, bbox, questionType);
  const candidateMap = new Map<string, ChoiceCandidate>();
  for (const candidate of candidates) {
    const prev = candidateMap.get(candidate.key);
    if (!prev || candidate.score > prev.score) {
      candidateMap.set(candidate.key, candidate);
    }
  }

  if (candidateMap.size === 0) {
    applyFallbackChoiceMapping(scope, bbox, questionType, candidateMap);
  }

  let filledCount = 0;
  for (const desiredKey of desiredKeys) {
    const candidate = candidateMap.get(desiredKey);
    if (!candidate) continue;
    if (applyChoiceSelection(candidate, true)) filledCount += 1;
  }

  if (questionType === "multi_choice") {
    for (const [key, candidate] of candidateMap.entries()) {
      if (desiredKeys.includes(key)) continue;
      applyChoiceSelection(candidate, false);
    }
  }

  return filledCount > 0
    ? { ok: true, filledCount, message: `已填写 ${filledCount} 个选项` }
    : { ok: false, filledCount: 0, message: "未找到可填写的选项控件" };
}

function fillTextLikeAnswer(
  scope: Element,
  bbox: BoundingBox,
  result: ParseResult,
  questionType: ParseResult["questionType"],
): FillAnswerResult {
  const controls = collectTextControls(scope, bbox);
  if (!controls.length) {
    return { ok: false, filledCount: 0, message: "未找到文本输入框" };
  }

  const answerSource = resolveTextAnswerSource(result, controls.length, questionType);
  if (!answerSource) {
    return { ok: false, filledCount: 0, message: "答案需人工确认，未自动填写" };
  }

  const parts = splitAnswerParts(answerSource, controls.length);
  const values = controls.length === 1
    ? [formatSingleTextAnswer(answerSource, questionType)]
    : buildControlValues(parts, controls.length, answerSource);

  let filledCount = 0;
  controls.forEach((control, index) => {
    const nextValue = values[index] ?? "";
    if (!nextValue) return;
    if (applyTextValue(control, nextValue)) filledCount += 1;
  });

  return filledCount > 0
    ? { ok: true, filledCount, message: `已填写 ${filledCount} 个输入框` }
    : { ok: false, filledCount: 0, message: "未写入任何输入框" };
}

function resolveQuestionScope(bbox: BoundingBox): Element {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const stack = document.elementsFromPoint(cx, cy);
  const anchor = stack.find((el) => !isExtensionUiElement(el)) || document.body;

  let best: Element = anchor;
  let bestScore = Number.NEGATIVE_INFINITY;
  let node: Element | null = anchor;

  for (let depth = 0; depth < 12 && node; depth += 1) {
    if (isExtensionUiElement(node)) {
      node = node.parentElement;
      continue;
    }

    const rect = node.getBoundingClientRect();
    const inter = intersectionArea(rect, bbox);
    if (inter <= 0) {
      node = node.parentElement;
      continue;
    }

    const textCount = node.querySelectorAll(TEXT_INPUT_SELECTOR).length;
    const choiceCount = node.querySelectorAll(CHOICE_INPUT_SELECTOR).length;
    const area = Math.max(1, rect.width * rect.height);
    const bboxArea = Math.max(1, bbox.width * bbox.height);
    const overlapRatio = inter / Math.min(area, bboxArea);
    const areaRatio = area / bboxArea;

    let score = overlapRatio * 100 + textCount * 15 + choiceCount * 12 - depth * 5;
    if (areaRatio > 10) score -= 80;
    if (areaRatio < 0.4) score -= 20;
    if (node === document.body || node === document.documentElement) score -= 200;

    if (score > bestScore) {
      best = node;
      bestScore = score;
    }

    node = node.parentElement;
  }

  return best;
}

function collectChoiceCandidates(scope: Element, bbox: BoundingBox, questionType: ParseResult["questionType"]): ChoiceCandidate[] {
  const rows = Array.from(scope.querySelectorAll(OPTION_ROW_SELECTOR));
  const candidates: ChoiceCandidate[] = [];

  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue;
    if (!isVisible(row)) continue;

    const rect = row.getBoundingClientRect();
    if (!rectIntersectsExpandedBBox(rect, bbox, 28, 260)) continue;

    const text = normalizeText(row.innerText || row.textContent || "");
    if (!text || text.length > 120) continue;

    const key = inferRowKey(text, questionType);
    if (!key) continue;

    const input = findChoiceInput(row);
    const target = (findChoiceTarget(row) || input || row) as HTMLElement;
    const score = scoreRow(rect, bbox, text, row);
    candidates.push({ key, input, target, score });
  }

  return candidates;
}

function applyFallbackChoiceMapping(
  scope: Element,
  bbox: BoundingBox,
  questionType: ParseResult["questionType"],
  candidateMap: Map<string, ChoiceCandidate>,
) {
  const inputs = Array.from(scope.querySelectorAll(CHOICE_INPUT_SELECTOR))
    .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement)
    .filter((input) => rectIntersectsExpandedBBox(input.getBoundingClientRect(), bbox, 28, 260))
    .sort((a, b) => compareRectPosition(a.getBoundingClientRect(), b.getBoundingClientRect()));

  const order = questionType === "judge" ? ["对", "错"] : ["A", "B", "C", "D", "E", "F"];
  inputs.forEach((input, index) => {
    const key = order[index];
    if (!key || candidateMap.has(key)) return;
    candidateMap.set(key, { key, input, target: input, score: 1 });
  });
}

function collectTextControls(scope: Element, bbox: BoundingBox): HTMLElement[] {
  return Array.from(scope.querySelectorAll(TEXT_INPUT_SELECTOR))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((node) => isVisible(node))
    .filter((node) => rectIntersectsExpandedBBox(node.getBoundingClientRect(), bbox, 40, 320))
    .sort((a, b) => compareRectPosition(a.getBoundingClientRect(), b.getBoundingClientRect()));
}

function buildControlValues(parts: string[], count: number, fallbackAnswer: string): string[] {
  if (parts.length >= count) return parts.slice(0, count);

  if (parts.length === 1 && count > 1) {
    const splitMore = parts[0]
      .split(/[，,、；;|/]+/)
      .map((part) => normalizeFilledPart(cleanAnswerPart(part)))
      .filter(Boolean);
    if (splitMore.length >= count) return splitMore.slice(0, count);
  }

  const values = [...parts];
  while (values.length < count) {
    values.push(values.length === 0 ? normalizeFilledPart(cleanAnswerPart(fallbackAnswer)) : "");
  }
  return values;
}

function formatSingleTextAnswer(answer: string, questionType: ParseResult["questionType"]): string {
  if (questionType === "short_answer") return String(answer || "").trim();
  return normalizeFilledPart(cleanAnswerPart(answer));
}

function shouldUseDetailedAnswer(answer: string): boolean {
  const normalized = String(answer || "").trim();
  return !normalized || UNSAFE_TEXT_ANSWER_MARKERS.includes(normalized);
}

function resolveTextAnswerSource(
  result: ParseResult,
  controlCount: number,
  questionType: ParseResult["questionType"],
): string | null {
  if (!shouldUseDetailedAnswer(result.answer)) {
    return result.answer;
  }

  const candidates = [
    String(result.detailedExplanation || "").trim(),
    String(result.briefExplanation || "").trim(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const parts = splitAnswerParts(candidate, controlCount);
    if (!looksStructuredTextAnswer(parts, candidate, controlCount, questionType)) continue;
    return candidate;
  }

  return null;
}

function looksStructuredTextAnswer(
  parts: string[],
  source: string,
  controlCount: number,
  questionType: ParseResult["questionType"],
): boolean {
  if (!parts.length) return false;
  if (/需人工确认|见分点答案|示例答案|无法判断|无法确定|题干不完整|信息不足/.test(source)) return false;
  if (parts.some((part) => /因为|所以|说明|解析|理由|步骤|首先|其次/.test(part))) return false;

  if (questionType === "fill_blank" && controlCount > 1) {
    if (parts.length < controlCount) return false;
    if (parts.slice(0, controlCount).some((part) => part.length > 60)) return false;
  }

  return true;
}

function cleanAnswerPart(part: string): string {
  return String(part || "")
    .replace(/^(?:\d+\.\d+\s*[:：]?|\(?\d+\)?[.)、]|第\s*\d+\s*空\s*[:：]?|空\s*\d+\s*[:：]?|答案?\s*\d+\s*[:：]?)\s*/, "")
    .replace(/^[:：\s]*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFilledPart(part: string): string {
  return String(part || "")
    .replace(/^\d+\s*[:：.。、]\s*/, "")
    .trim();
}

function inferTypeFromAnswer(scope: Element, answer: string): ParseResult["questionType"] {
  const textControls = scope.querySelectorAll(TEXT_INPUT_SELECTOR).length;
  const choiceControls = scope.querySelectorAll(CHOICE_INPUT_SELECTOR).length;

  if (textControls > 0) {
    return textControls > 1 ? "fill_blank" : "short_answer";
  }

  if (choiceControls > 0) {
    const normalized = String(answer || "").toLowerCase();
    if (JUDGE_TRUE_KEYS.some((key) => normalized.includes(key)) || JUDGE_FALSE_KEYS.some((key) => normalized.includes(key))) {
      return "judge";
    }
    const letters = answer.match(/[A-Z]/gi) || [];
    return letters.length > 1 ? "multi_choice" : "single_choice";
  }

  return "unknown";
}

function inferRowKey(text: string, questionType: ParseResult["questionType"]): string | null {
  const normalized = normalizeText(text);

  if (questionType === "judge") {
    if (/^(?:对|正确|true)\b/i.test(normalized) || /(?:^|\s)(?:对|正确|true)(?:\s|$)/i.test(normalized)) return "对";
    if (/^(?:错|错误|false)\b/i.test(normalized) || /(?:^|\s)(?:错|错误|false)(?:\s|$)/i.test(normalized)) return "错";
    return null;
  }

  const match = normalized.match(/(?:^|\s)([A-F])[\.\):：、\s]/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function findChoiceInput(row: Element): HTMLInputElement | null {
  const direct = row.querySelector(CHOICE_INPUT_SELECTOR);
  if (direct instanceof HTMLInputElement) return direct;

  const siblingInput = row.closest("label")?.querySelector(CHOICE_INPUT_SELECTOR);
  return siblingInput instanceof HTMLInputElement ? siblingInput : null;
}

function findChoiceTarget(row: Element): HTMLElement | null {
  const ownClickable = row.closest("label,.el-radio,.el-checkbox,.ivu-radio-wrapper,.ivu-checkbox-wrapper");
  if (ownClickable instanceof HTMLElement) return ownClickable;

  const descendantClickable = row.querySelector("label,.el-radio,.el-checkbox,.ivu-radio-wrapper,.ivu-checkbox-wrapper");
  if (descendantClickable instanceof HTMLElement) return descendantClickable;

  return row instanceof HTMLElement ? row : null;
}

function applyChoiceSelection(candidate: ChoiceCandidate, shouldSelect: boolean): boolean {
  const input = candidate.input;
  if (!input) {
    if (!shouldSelect) return false;
    clickElement(candidate.target);
    return true;
  }

  if (input.type === "checkbox") {
    if (input.checked === shouldSelect) return false;
    if (tryClickCandidate(candidate, shouldSelect)) return true;
    setNativeChecked(input, shouldSelect);
    dispatchChoiceEvents(input);
    return true;
  }

  if (!shouldSelect || input.checked) return false;
  if (tryClickCandidate(candidate, true)) return true;
  setNativeChecked(input, true);
  dispatchChoiceEvents(input);
  return true;
}

function tryClickCandidate(candidate: ChoiceCandidate, expectedChecked: boolean): boolean {
  const input = candidate.input;
  if (!input) return false;

  const before = input.checked;
  clickElement(candidate.target);
  if (input.checked === expectedChecked) return input.checked !== before;

  if (candidate.target !== input) {
    clickElement(input);
    if (input.checked === expectedChecked) return input.checked !== before;
  }

  return false;
}

function applyTextValue(control: HTMLElement, value: string): boolean {
  if (control instanceof HTMLInputElement) {
    if (control.value === value) return false;
    control.focus();
    setNativeInputValue(control, value);
    dispatchTextEvents(control);
    return true;
  }

  if (control instanceof HTMLTextAreaElement) {
    if (control.value === value) return false;
    control.focus();
    setNativeTextareaValue(control, value);
    dispatchTextEvents(control);
    return true;
  }

  if (control.isContentEditable) {
    if ((control.textContent || "") === value) return false;
    control.focus();
    control.textContent = value;
    dispatchTextEvents(control);
    return true;
  }

  return false;
}

function dispatchTextEvents(target: HTMLElement) {
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
  target.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

function dispatchChoiceEvents(target: HTMLInputElement) {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickElement(target: HTMLElement) {
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  target.click();
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

function setNativeTextareaValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

function setNativeChecked(input: HTMLInputElement, checked: boolean) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
  if (setter) {
    setter.call(input, checked);
  } else {
    input.checked = checked;
  }
}

function scoreRow(rect: DOMRect, bbox: BoundingBox, text: string, row: Element): number {
  const inter = intersectionArea(rect, bbox);
  const optionPrefix = /^[A-F][\.\):：、]|^(?:对|错|正确|错误|true|false)/i.test(text) ? 20 : 0;
  const hasInput = row.querySelector(CHOICE_INPUT_SELECTOR) ? 15 : 0;
  return inter + optionPrefix + hasInput - Math.abs(rect.top - bbox.y) * 0.2;
}

function compareRectPosition(a: DOMRect, b: DOMRect): number {
  return (a.top - b.top) || (a.left - b.left);
}

function rectIntersectsExpandedBBox(rect: DOMRect, bbox: BoundingBox, verticalPad: number, horizontalPad: number): boolean {
  return !(
    rect.right < bbox.x - horizontalPad
    || rect.left > bbox.x + bbox.width + horizontalPad
    || rect.bottom < bbox.y - verticalPad
    || rect.top > bbox.y + bbox.height + verticalPad
  );
}

function intersectionArea(rect: DOMRect, bbox: BoundingBox): number {
  const left = Math.max(rect.left, bbox.x);
  const top = Math.max(rect.top, bbox.y);
  const right = Math.min(rect.right, bbox.x + bbox.width);
  const bottom = Math.min(rect.bottom, bbox.y + bbox.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

function isVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function normalizeText(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isExtensionUiElement(el: Element): boolean {
  const id = (el as HTMLElement).id || "";
  if (id.startsWith("qs-")) return true;
  return !!el.closest?.("#qs-floating-host, #qs-highlight-layer, #qs-overlay-root, #qs-capture-toolbar");
}
