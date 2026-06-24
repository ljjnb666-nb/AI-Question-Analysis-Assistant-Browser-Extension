import type { ParseResult } from "../types";
import { normalizeTextLoose } from "./parseResultNormalization";

export function normalizeAnswer(raw: string): string {
  const original = String(raw || "").trim();
  if (!original) return "—";
  const s = original.toUpperCase();
  const letters = s.match(/[A-D]/g) || [];
  if (letters.length === 0) return original;
  const uniqueSorted = Array.from(new Set(letters)).sort();
  return uniqueSorted.length > 1 ? uniqueSorted.join(",") : uniqueSorted[0];
}

export function inferChoiceAnswerFromExplanation(
  questionType: ParseResult["questionType"],
  recognizedText: string,
  previewText: string,
  briefExplanation: string,
  detailedExplanation: string,
): string {
  const explanation = `${briefExplanation || ""}\n${detailedExplanation || ""}`.trim();
  if (!explanation) return "";

  const explicit = explanation.match(
    /(?:故选|因此选|所以选|应选|对应选项|答案(?:应)?为|正确答案(?:应)?为)\s*[:：]?\s*([A-F](?:\s*[,，、/|]\s*[A-F])*)/i,
  );
  if (explicit?.[1]) {
    return normalizeAnswer(explicit[1].replace(/\s+/g, ""));
  }

  const summarizedSet = extractSummarizedChoiceSetFromExplanation(explanation, questionType);
  if (summarizedSet) {
    return summarizedSet;
  }

  const sourceQuestionText = `${recognizedText || ""}\n${previewText || ""}`.trim();
  const inferredByJudgement = inferChoiceAnswerByOptionJudgement(sourceQuestionText, explanation, questionType);
  if (inferredByJudgement) {
    return inferredByJudgement;
  }

  const inferredByOptionText = inferChoiceAnswerByOptionText(sourceQuestionText, explanation, questionType);
  if (inferredByOptionText) {
    return inferredByOptionText;
  }

  return "";
}

export function inferChoiceTypeFromQuestionText(text: string): "single_choice" | "multi_choice" | null {
  const normalized = normalizeTextLoose(text);
  if (!normalized) return null;
  const optionMatches = normalized.match(/(?:^|\s)[A-D][\.\):：、]/g) || [];
  const optionCount = optionMatches.length;
  if (optionCount >= 4) return /多选|不定项|多项选择|select all|multiple choice/i.test(normalized) ? "multi_choice" : "single_choice";
  if (optionCount >= 2 && /多选|不定项|多项选择|select all|multiple choice/i.test(normalized)) return "multi_choice";
  return null;
}

export function extractOptionSelections(parsed: Record<string, unknown>): ParseResult["optionSelections"] | undefined {
  const raw = parsed.optionSelections;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const normalized: NonNullable<ParseResult["optionSelections"]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const upper = key.toUpperCase();
    if (!/^[A-F]$/.test(upper)) continue;
    if (value === true || value === false || value === null) {
      normalized[upper as keyof typeof normalized] = value;
      continue;
    }
    if (typeof value === "string") {
      const lower = value.trim().toLowerCase();
      if (["true", "correct", "selected", "yes", "1"].includes(lower)) {
        normalized[upper as keyof typeof normalized] = true;
      } else if (["false", "incorrect", "unselected", "no", "0"].includes(lower)) {
        normalized[upper as keyof typeof normalized] = false;
      } else if (["null", "uncertain", "unknown", "?"].includes(lower)) {
        normalized[upper as keyof typeof normalized] = null;
      }
    }
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

export function deriveChoiceAnswerFromSelections(
  questionType: ParseResult["questionType"],
  optionSelections?: ParseResult["optionSelections"],
): string {
  if (!optionSelections) return "";
  if (questionType !== "single_choice" && questionType !== "multi_choice") return "";

  const selected = Object.entries(optionSelections)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .sort();

  if (!selected.length) return "";
  if (questionType === "single_choice") {
    return selected.length === 1 ? selected[0] || "" : "";
  }
  return selected.join(",");
}

export function isOptionLetterSet(text: string): boolean {
  return /^[A-D](?:\s*[,，、/|]\s*[A-D])*$/.test(String(text || "").trim().toUpperCase());
}

export function resolveStableChoiceResolution(
  questionType: ParseResult["questionType"],
  rawChoiceAnswer: string,
  answerFromSelections: string,
  answerFromExplanation: string,
  explanationText: string,
): { answer: string; optionSelections?: ParseResult["optionSelections"] } {
  const structuredAnswer = answerFromSelections || answerFromExplanation;
  if (answerFromSelections && answerFromExplanation && answerFromSelections !== answerFromExplanation) {
    return { answer: "" };
  }
  if (structuredAnswer) {
    return {
      answer: structuredAnswer,
      optionSelections: deriveOptionSelectionsFromAnswer(questionType, structuredAnswer),
    };
  }

  const normalizedRaw = normalizeAnswer(rawChoiceAnswer);
  if (!normalizedRaw || !isOptionLetterSet(normalizedRaw)) {
    return { answer: "" };
  }

  const uncertainty = /(无法|不确定|看不清|信息不足|题干不完整|暂无法确认|不能确定|缺少)/.test(explanationText);
  if (uncertainty) {
    return { answer: "" };
  }

  return {
    answer: normalizedRaw,
    optionSelections: deriveOptionSelectionsFromAnswer(questionType, normalizedRaw),
  };
}

function extractSummarizedChoiceSetFromExplanation(
  explanation: string,
  questionType: ParseResult["questionType"],
): string {
  const source = String(explanation || "");
  if (!source) return "";

  const summaryPattern =
    /(?:因此|所以|综上|可见|故|由此可见)?\s*([A-F](?:\s*[,，、/|]\s*[A-F]){1,5})\s*(?:四项|三项|两项|以上各项|各项)?\s*(?:均)?(?:正确|符合题意|符合要求|应选|入选|当选|为正确答案|都是正确的|均为.*?(?:特征|内容|原因|条件))/i;
  const summaryMatch = source.match(summaryPattern);
  if (summaryMatch?.[1]) {
    return normalizeAnswer(summaryMatch[1].replace(/\s+/g, ""));
  }

  if (questionType !== "multi_choice") return "";

  const listedAllCorrectPattern =
    /([A-F](?:\s*[,，、/|]\s*[A-F]){1,5})\s*(?:均|都)(?:正确|符合题意|符合要求|应选|可选|入选)/i;
  const listedAllCorrectMatch = source.match(listedAllCorrectPattern);
  if (listedAllCorrectMatch?.[1]) {
    return normalizeAnswer(listedAllCorrectMatch[1].replace(/\s+/g, ""));
  }

  return "";
}

function inferChoiceAnswerByOptionJudgement(
  sourceQuestionText: string,
  explanationText: string,
  questionType: ParseResult["questionType"],
): string {
  if (questionType !== "single_choice" && questionType !== "multi_choice") return "";

  const stem = normalizeTextLoose(sourceQuestionText);
  const verdicts = extractOptionJudgementVerdicts(explanationText);
  if (!verdicts.length) return "";

  const positiveKeys = verdicts.filter((item) => item.verdict === "positive").map((item) => item.key);
  const negativeKeys = verdicts.filter((item) => item.verdict === "negative").map((item) => item.key);

  if (questionType === "multi_choice") {
    return positiveKeys.length ? Array.from(new Set(positiveKeys)).sort().join(",") : "";
  }

  if (isNegativeChoiceStem(stem) && negativeKeys.length === 1) {
    return negativeKeys[0] || "";
  }
  if (isPositiveChoiceStem(stem) && positiveKeys.length === 1) {
    return positiveKeys[0] || "";
  }
  if (!isNegativeChoiceStem(stem) && positiveKeys.length === 1 && negativeKeys.length >= 1) {
    return positiveKeys[0] || "";
  }
  if (!isPositiveChoiceStem(stem) && negativeKeys.length === 1 && positiveKeys.length >= 1) {
    return negativeKeys[0] || "";
  }

  return "";
}

function inferChoiceAnswerByOptionText(
  sourceQuestionText: string,
  explanationText: string,
  questionType: ParseResult["questionType"],
): string {
  const { options } = splitStemAndOptions(sourceQuestionText);
  if (!options.length) return "";

  const normalizedExplanation = normalizeChoiceMatchText(explanationText);
  const matches = options
    .map((option) => {
      const normalizedValue = normalizeChoiceMatchText(option.value);
      if (!normalizedValue) return null;
      if (!explanationContainsOption(normalizedExplanation, normalizedValue)) return null;
      return { key: option.key, score: normalizedValue.length };
    })
    .filter((item): item is { key: string; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  if (!matches.length) return "";
  if (questionType === "multi_choice") {
    return Array.from(new Set(matches.map((item) => item.key))).sort().join(",");
  }
  const uniqueKeys = Array.from(new Set(matches.map((item) => item.key)));
  if (uniqueKeys.length !== 1) return "";
  if ((matches[0]?.score ?? 0) < 4) return "";
  return matches[0]?.key || "";
}

function extractChoiceKeysFromAnswerText(answer: string): string[] {
  const letters = String(answer || "").toUpperCase().match(/[A-F]/g) || [];
  return Array.from(new Set(letters.filter((letter) => letter >= "A" && letter <= "F"))).sort();
}

function deriveOptionSelectionsFromAnswer(
  questionType: ParseResult["questionType"],
  answer: string,
): ParseResult["optionSelections"] | undefined {
  if (questionType !== "single_choice" && questionType !== "multi_choice") return undefined;
  const keys = extractChoiceKeysFromAnswerText(answer);
  if (!keys.length) return undefined;
  const out: NonNullable<ParseResult["optionSelections"]> = {};
  for (const key of keys) {
    out[key as keyof typeof out] = true;
  }
  return out;
}

function splitStemAndOptions(text: string): { stem: string; options: Array<{ key: string; value: string }> } {
  const normalized = normalizeTextLoose(text);
  const firstOptionIdx = normalized.search(/[A-D][\.\):：、]/);
  if (firstOptionIdx < 0) return { stem: normalized, options: [] };

  const stem = normalizeTextLoose(normalized.slice(0, firstOptionIdx));
  const optionSegment = normalized.slice(firstOptionIdx);
  const rawMatches: RegExpMatchArray[] = Array.from(
    optionSegment.matchAll(/([A-D])[\.\):：、]\s*([\s\S]*?)(?=(?:\s+[A-D][\.\):：、])|$)/g),
  );
  const dedup = new Map<string, string>();
  for (const match of rawMatches) {
    const key = match[1];
    const value = normalizeTextLoose(match[2] || "");
    if (!value) continue;
    if (!dedup.has(key)) dedup.set(key, value);
  }

  return {
    stem,
    options: Array.from(dedup.entries()).map(([key, value]) => ({ key, value })),
  };
}

function explanationContainsOption(explanation: string, optionValue: string): boolean {
  if (!optionValue) return false;
  if (optionValue.length <= 3) {
    const escaped = escapeRegex(optionValue);
    return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, "i").test(explanation);
  }
  return explanation.includes(optionValue);
}

function normalizeChoiceMatchText(text: string): string {
  return String(text || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]{}<>《》“”"'`~!@#$%^&*+=|\\/:;,.?，。；：、·—\-]/g, "");
}

function extractOptionJudgementVerdicts(text: string): Array<{ key: string; verdict: "positive" | "negative" }> {
  const source = String(text || "");
  if (!source) return [];

  const verdicts = new Map<string, "positive" | "negative">();
  const optionLead = String.raw`(?:项|选项|[\.\):：、])`;
  const positiveRe = /([A-F])\s*(?:项|选项)?\s*(?:是|为)?\s*(正确|对|符合题意|符合要求|成立|可行|恰当|合理|无误|正确的)/gi;
  const negativeRe = /([A-F])\s*(?:项|选项)?\s*(?:是|为)?\s*(错误|错|不正确|不对|不符合题意|不符合要求|不成立|不可行|不恰当|不合理|有误|表述错误|说法错误)/gi;
  const positiveTailRe = new RegExp(
    String.raw`([A-F])\s*${optionLead}\s*((?:(?![A-F]\s*${optionLead}).){0,180}?)(正确|对|符合题意|符合要求|成立|可行|恰当|合理|无误|正确的)`,
    "gi",
  );
  const negativeTailRe = new RegExp(
    String.raw`([A-F])\s*${optionLead}\s*((?:(?![A-F]\s*${optionLead}).){0,180}?)(错误|错|不正确|不对|不符合题意|不符合要求|不成立|不可行|不恰当|不合理|有误|表述错误|说法错误)`,
    "gi",
  );

  for (const match of source.matchAll(negativeRe)) {
    const key = match[1]?.toUpperCase();
    if (key) verdicts.set(key, "negative");
  }
  for (const match of source.matchAll(negativeTailRe)) {
    const key = match[1]?.toUpperCase();
    if (key) verdicts.set(key, "negative");
  }
  for (const match of source.matchAll(positiveRe)) {
    const key = match[1]?.toUpperCase();
    if (key && !verdicts.has(key)) verdicts.set(key, "positive");
  }
  for (const match of source.matchAll(positiveTailRe)) {
    const key = match[1]?.toUpperCase();
    if (key && !verdicts.has(key)) verdicts.set(key, "positive");
  }

  return Array.from(verdicts.entries()).map(([key, verdict]) => ({ key, verdict }));
}

function isNegativeChoiceStem(text: string): boolean {
  return /(错误|不正确|不符合|不能|不属于|不是|有误|不恰当|不合理|错误的是|说法错误|表述错误|错误选项)/i.test(text);
}

function isPositiveChoiceStem(text: string): boolean {
  return /(正确|符合|属于|可以|能够|合理|恰当|正确的是|符合的是|表述正确)/i.test(text)
    && !isNegativeChoiceStem(text);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
