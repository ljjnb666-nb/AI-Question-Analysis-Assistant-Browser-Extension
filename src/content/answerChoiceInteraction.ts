import type { BoundingBox, ParseResult } from "@/shared/types";
import {
  extractChoiceKeysFromExplanations as extractChoiceKeysFromExplanationsCore,
  inferChoiceKeysFromContent as inferChoiceKeysFromContentCore,
  inferRowKey as inferRowKeyCore,
  normalizeChoiceAnswerKeys as normalizeChoiceAnswerKeysCore,
} from "./answerText";
import type { ChoiceHelperDeps, FillAnswerResult, VerifyAnswerResult } from "./answerTypes";

export interface ChoiceCandidate {
  key: string;
  input: HTMLInputElement | null;
  target: HTMLElement;
  row: HTMLElement;
  score: number;
  labelText: string;
}

const CHOICE_INPUT_SELECTOR = "input[type='radio'],input[type='checkbox']";
const OPTION_ROW_SELECTOR = "li,label,div,p,span";

export function verifyChoiceAnswerInScope(
  scope: Element,
  bbox: BoundingBox,
  result: ParseResult,
  questionType: ParseResult["questionType"],
  deps: ChoiceHelperDeps,
): VerifyAnswerResult {
  const candidateMap = buildChoiceCandidateMap(scope, bbox, questionType, deps);
  const expectedKeys = resolveDesiredChoiceKeys(result, questionType, candidateMap);
  if (!expectedKeys.length) {
    return { ok: false, expectedKeys: [], actualKeys: [], message: "无法映射期望选项" };
  }

  const actualKeys = getSelectedChoiceKeys(candidateMap).sort();
  const expectedSorted = [...expectedKeys].sort();
  const ok =
    actualKeys.length === expectedSorted.length
    && expectedSorted.every((key, index) => actualKeys[index] === key);

  return {
    ok,
    expectedKeys: expectedSorted,
    actualKeys,
    message: ok
      ? `已校验选项 ${expectedSorted.join(",")}`
      : `期望 ${expectedSorted.join(",")}，实际 ${actualKeys.join(",") || "未选中"}`,
  };
}

export async function fillChoiceLikeAnswer(
  scope: Element,
  bbox: BoundingBox,
  result: ParseResult,
  questionType: ParseResult["questionType"],
  deps: ChoiceHelperDeps,
): Promise<FillAnswerResult> {
  const candidateMap = buildChoiceCandidateMap(scope, bbox, questionType, deps);
  const desiredKeys = resolveDesiredChoiceKeys(result, questionType, candidateMap);
  if (!desiredKeys.length) {
    return { ok: false, filledCount: 0, message: "答案格式无法映射到选项" };
  }

  const initiallySelected = new Set(getSelectedChoiceKeys(candidateMap));
  for (const desiredKey of desiredKeys) {
    const candidate = candidateMap.get(desiredKey);
    if (!candidate) continue;
    await applyChoiceSelection(candidate, true, deps);
  }

  if (questionType === "multi_choice") {
    for (const [key, candidate] of candidateMap.entries()) {
      if (desiredKeys.includes(key)) continue;
      await applyChoiceSelection(candidate, false, deps);
    }
  }

  await deps.pause(questionType === "multi_choice" ? 240 : 160);

  const finalSelected = new Set(getSelectedChoiceKeys(candidateMap));
  const filledCount = desiredKeys.filter((key) => finalSelected.has(key) && !initiallySelected.has(key)).length;
  const allDesiredSelected = desiredKeys.every((key) => finalSelected.has(key));

  if (allDesiredSelected) {
    if (filledCount > 0) {
      return { ok: true, filledCount, message: `已填写 ${filledCount} 个选项` };
    }
    return { ok: true, filledCount: 0, message: "已校验当前答案" };
  }

  return filledCount > 0
    ? { ok: true, filledCount, message: `已填写 ${filledCount} 个选项` }
    : { ok: false, filledCount: 0, message: "未找到可填写的选项控件" };
}

function buildChoiceCandidateMap(
  scope: Element,
  bbox: BoundingBox,
  questionType: ParseResult["questionType"],
  deps: ChoiceHelperDeps,
): Map<string, ChoiceCandidate> {
  const candidates = collectChoiceCandidates(scope, bbox, questionType, deps);
  const candidateMap = new Map<string, ChoiceCandidate>();
  for (const candidate of candidates) {
    const prev = candidateMap.get(candidate.key);
    if (!prev || candidate.score > prev.score) {
      candidateMap.set(candidate.key, candidate);
    }
  }

  if (candidateMap.size === 0) {
    applyFallbackChoiceMapping(scope, bbox, questionType, candidateMap, deps);
  }

  return candidateMap;
}

function collectChoiceCandidates(
  scope: Element,
  bbox: BoundingBox,
  questionType: ParseResult["questionType"],
  deps: ChoiceHelperDeps,
): ChoiceCandidate[] {
  const rows = Array.from(scope.querySelectorAll(OPTION_ROW_SELECTOR));
  const candidates: ChoiceCandidate[] = [];

  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue;
    if (!deps.isVisible(row)) continue;

    const rect = row.getBoundingClientRect();
    if (!deps.rectIntersectsExpandedBBox(rect, bbox, 28, 260)) continue;

    const text = deps.normalizeText(row.innerText || row.textContent || "");
    if (!text || text.length > 160) continue;

    const key = inferRowKeyCore(text, questionType, deps.normalizeText);
    if (!key) continue;

    const input = findChoiceInput(row);
    const target = (findChoiceTarget(row) || input || row) as HTMLElement;
    const hostRow = (
      target.closest(".option-item,label,.el-radio,.el-checkbox,.ivu-radio-wrapper,.ivu-checkbox-wrapper")
      || row.closest(".option-item,label,.el-radio,.el-checkbox,.ivu-radio-wrapper,.ivu-checkbox-wrapper")
      || row
    ) as HTMLElement;
    const score = scoreRow(hostRow.getBoundingClientRect(), bbox, text, hostRow, deps);
    candidates.push({ key, input, target, row: hostRow, score, labelText: text });
  }

  return candidates;
}

function applyFallbackChoiceMapping(
  scope: Element,
  bbox: BoundingBox,
  questionType: ParseResult["questionType"],
  candidateMap: Map<string, ChoiceCandidate>,
  deps: ChoiceHelperDeps,
) {
  const inputs = Array.from(scope.querySelectorAll(CHOICE_INPUT_SELECTOR))
    .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement)
    .filter((input) => deps.rectIntersectsExpandedBBox(input.getBoundingClientRect(), bbox, 28, 260))
    .sort((a, b) => deps.compareRectPosition(a.getBoundingClientRect(), b.getBoundingClientRect()));

  const order = questionType === "judge" ? ["对", "错"] : ["A", "B", "C", "D", "E", "F"];
  inputs.forEach((input, index) => {
    const key = order[index];
    if (!key || candidateMap.has(key)) return;
    candidateMap.set(key, {
      key,
      input,
      target: input,
      row: input.closest(".option-item,label,.el-radio,.el-checkbox,.ivu-radio-wrapper,.ivu-checkbox-wrapper") as HTMLElement ?? input,
      score: 1,
      labelText: deps.normalizeText(input.closest("label")?.textContent || input.parentElement?.textContent || key),
    });
  });
}

function resolveDesiredChoiceKeys(
  result: ParseResult,
  questionType: ParseResult["questionType"],
  candidateMap: Map<string, ChoiceCandidate>,
): string[] {
  const structuredKeys = Object.entries(result.optionSelections || {})
    .filter(([, selected]) => selected === true)
    .map(([key]) => key.toUpperCase())
    .filter((key) => candidateMap.has(key));
  if (structuredKeys.length) {
    return Array.from(new Set(structuredKeys)).sort();
  }

  const directKeys = normalizeChoiceAnswerKeysCore(result.answer, questionType);
  if (directKeys.length) return directKeys;

  const inferredKeys = inferChoiceKeysFromContentCore(result, questionType, Array.from(candidateMap.values()));
  if (inferredKeys.length) return inferredKeys;

  return extractChoiceKeysFromExplanationsCore(result, questionType);
}

function findChoiceInput(row: Element): HTMLInputElement | null {
  const direct = row.querySelector(CHOICE_INPUT_SELECTOR);
  if (direct instanceof HTMLInputElement) return direct;

  const siblingInput = row.closest("label")?.querySelector(CHOICE_INPUT_SELECTOR);
  return siblingInput instanceof HTMLInputElement ? siblingInput : null;
}

function findChoiceTarget(row: Element): HTMLElement | null {
  const ownClickable = row.closest("label,.el-radio,.el-checkbox,.ivu-radio-wrapper,.ivu-checkbox-wrapper,.option-item");
  if (ownClickable instanceof HTMLElement) return ownClickable;

  const descendantClickable = row.querySelector("label,.el-radio,.el-checkbox,.ivu-radio-wrapper,.ivu-checkbox-wrapper,.option-item");
  if (descendantClickable instanceof HTMLElement) return descendantClickable;

  return row instanceof HTMLElement ? row : null;
}

async function applyChoiceSelection(
  candidate: ChoiceCandidate,
  shouldSelect: boolean,
  deps: ChoiceHelperDeps,
): Promise<boolean> {
  const input = candidate.input;
  const beforeSelected = isCandidateSelected(candidate);
  if (!input) {
    if (!shouldSelect) return beforeSelected ? await clearCustomChoiceSelection(candidate, deps) : false;
    if (beforeSelected) return false;
    return clickCustomChoiceCandidate(candidate, deps);
  }

  if (input.type === "checkbox") {
    if (input.checked === shouldSelect) return false;
    if (await tryClickCandidate(candidate, shouldSelect, deps)) return true;
    deps.setNativeChecked(input, shouldSelect);
    deps.dispatchChoiceEvents(input);
    return true;
  }

  if (!shouldSelect || input.checked) return false;
  if (await tryClickCandidate(candidate, true, deps)) return true;
  deps.setNativeChecked(input, true);
  deps.dispatchChoiceEvents(input);
  return isCandidateSelected(candidate) && !beforeSelected;
}

async function tryClickCandidate(
  candidate: ChoiceCandidate,
  expectedChecked: boolean,
  deps: ChoiceHelperDeps,
): Promise<boolean> {
  const input = candidate.input;
  if (!input) return false;

  const before = input.checked;
  for (const target of collectChoiceClickTargets(candidate)) {
    deps.clickElement(target);
    if (input.checked === expectedChecked || isCandidateSelected(candidate) === expectedChecked) {
      return (input.checked !== before) || isCandidateSelected(candidate);
    }
    if (await deps.requestRealClick(target)) {
      if (input.checked === expectedChecked || isCandidateSelected(candidate) === expectedChecked) {
        return (input.checked !== before) || isCandidateSelected(candidate);
      }
    }
  }

  deps.clickElement(input);
  if (input.checked === expectedChecked || isCandidateSelected(candidate) === expectedChecked) {
    return (input.checked !== before) || isCandidateSelected(candidate);
  }

  return false;
}

async function clickCustomChoiceCandidate(candidate: ChoiceCandidate, deps: ChoiceHelperDeps): Promise<boolean> {
  for (const target of collectChoiceClickTargets(candidate)) {
    deps.clickElement(target);
    if (isCandidateSelected(candidate)) return true;
    if (await deps.requestRealClick(target) && isCandidateSelected(candidate)) return true;
  }
  return false;
}

async function clearCustomChoiceSelection(candidate: ChoiceCandidate, deps: ChoiceHelperDeps): Promise<boolean> {
  for (const target of collectChoiceClickTargets(candidate)) {
    deps.clickElement(target);
    if (!isCandidateSelected(candidate)) return true;
    if (await deps.requestRealClick(target) && !isCandidateSelected(candidate)) return true;
  }
  return false;
}

function collectChoiceClickTargets(candidate: ChoiceCandidate): HTMLElement[] {
  const targets: HTMLElement[] = [];
  const push = (el: Element | null | undefined) => {
    if (!(el instanceof HTMLElement)) return;
    if (!targets.includes(el)) targets.push(el);
  };

  push(candidate.target);
  push(candidate.row);
  push(candidate.row.querySelector(".option-order"));
  push(candidate.row.querySelector(".option-content"));
  push(candidate.row.querySelector("p"));
  push(candidate.row.querySelector("i"));
  push(candidate.row.querySelector("img"));
  return targets;
}

function isCandidateSelected(candidate: ChoiceCandidate): boolean {
  if (candidate.input?.checked) return true;
  const row = candidate.row;
  const cls = String(row.className || "");
  if (/is-choose|selected|checked|active/.test(cls)) return true;
  const ariaChecked = row.getAttribute("aria-checked");
  if (ariaChecked === "true") return true;
  const iconCls = String(row.querySelector("i")?.className || "");
  return /xuanzhong|selected|checked|active/.test(iconCls);
}

function getSelectedChoiceKeys(candidateMap: Map<string, ChoiceCandidate>): string[] {
  return Array.from(candidateMap.values())
    .filter((candidate) => isCandidateSelected(candidate))
    .map((candidate) => candidate.key)
    .filter((key, index, list) => list.indexOf(key) === index);
}

function scoreRow(rect: DOMRect, bbox: BoundingBox, text: string, row: Element, deps: ChoiceHelperDeps): number {
  const inter = deps.intersectionArea(rect, bbox);
  const optionPrefix = /^[A-F][\.\):：、\s]|^(?:对|错|正确|错误|true|false)/i.test(text) ? 20 : 0;
  const hasInput = row.querySelector(CHOICE_INPUT_SELECTOR) ? 15 : 0;
  return inter + optionPrefix + hasInput - Math.abs(rect.top - bbox.y) * 0.2;
}
