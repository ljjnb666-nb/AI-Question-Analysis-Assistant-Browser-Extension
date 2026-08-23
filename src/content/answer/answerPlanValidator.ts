import type { ParseResult, QuestionBlock, ValidatedAnswerPlan } from "@/shared/types";
import { stableHash } from "../questionIdentity";
import { normalizeChoiceAnswerKeys, splitAnswerParts } from "../answerText";
import { booleanKey, type ControlMappingResult } from "./controlMapping";
import { countExpectedBlankParts, normalizeJudgeAnswer } from "../autoSolveHeuristics";

export function buildValidatedAnswerPlan(block: QuestionBlock, result: ParseResult, mapping: ControlMappingResult): ValidatedAnswerPlan {
  if (!mapping.ok) return { ok: false, code: "INVALID_ANSWER", message: mapping.message };
  const base = { schemaVersion: 1 as const, questionId: block.identity?.stableId ?? block.id, contentFingerprint: block.identity?.contentFingerprint ?? block.id, questionType: result.questionType, confidence: result.confidence, source: "parse-result" as const };
  const hash = (value: string) => stableHash(`${base.questionId}\u001f${base.contentFingerprint}\u001f${result.questionType}\u001f${value}`);
  if (result.questionType === "single_choice") {
    const keys = normalizeChoiceAnswerKeys(result.answer, result.questionType);
    if (keys.length !== 1) return { ok: false, code: "INVALID_SINGLE_CHOICE_CARDINALITY", message: "Single choice requires exactly one option" };
    if (!mapping.options.has(keys[0])) return { ok: false, code: "INVALID_ANSWER_OPTION", message: `Option ${keys[0]} is not mapped` };
    return { ok: true, plan: { ...base, kind: "single-choice", optionKeys: [keys[0]], answerSemanticHash: hash(keys[0]) } };
  }
  if (result.questionType === "multi_choice") {
    const keys = [...new Set(normalizeChoiceAnswerKeys(result.answer, result.questionType))].sort();
    if (!keys.length || keys.some((key) => !mapping.options.has(key))) return { ok: false, code: "INVALID_ANSWER_OPTION", message: "One or more selected options are not mapped" };
    return { ok: true, plan: { ...base, kind: "multiple-choice", optionKeys: keys, answerSemanticHash: hash(keys.join(",")) } };
  }
  if (result.questionType === "judge") {
    const normalized = normalizeJudgeAnswer(result.answer);
    if (normalized === null) return { ok: false, code: "INVALID_ANSWER", message: "Judge answer is not an explicit true or false semantic" };
    const value = normalized === "对";
    // Map from each control's own semantic label, never from A/B position.
    const semantic = [...mapping.options.entries()].filter(([, ref]) => booleanKey(ref.semanticText ?? "") === value);
    const chosen = semantic.length === 1 ? semantic[0][0] : undefined;
    if (!chosen) return { ok: false, code: "INVALID_ANSWER_OPTION", message: "Boolean option semantics are ambiguous" };
    return { ok: true, plan: { ...base, kind: "boolean", value, optionKey: chosen, answerSemanticHash: hash(String(value)) } };
  }
  if (result.questionType === "fill_blank") {
    const expected = countExpectedBlankParts(block.previewText) || countExpectedBlankParts(result.recognizedText);
    if (!expected || mapping.blanks.length !== expected) return { ok: false, code: "ANSWER_BLANK_COUNT_MISMATCH", message: "Semantic blank count and writable control count differ" };
    const parts = splitAnswerParts(result.answer, expected);
    if (parts.length !== expected || parts.some((part) => !part.trim())) return { ok: false, code: "ANSWER_BLANK_COUNT_MISMATCH", message: "Answer blank count does not match semantic expectation" };
    return { ok: true, plan: { ...base, kind: "fill-blank", blanks: parts.map((value, index) => ({ index, value })), answerSemanticHash: hash(parts.join("\u001f")) } };
  }
  if (result.questionType === "short_answer") {
    if (!mapping.text || !result.answer.trim()) return { ok: false, code: "INVALID_ANSWER", message: "Short answer requires one unambiguous writable control" };
    return { ok: true, plan: { ...base, kind: "short-answer", value: result.answer.trim(), answerSemanticHash: hash(result.answer.trim()) } };
  }
  return { ok: false, code: "UNSUPPORTED_QUESTION_TYPE", message: "Question type cannot be filled safely" };
}
