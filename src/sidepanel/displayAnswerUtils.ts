import type { HistoryEntry, ParseResult, QuestionType } from "@/shared/types";
import { normalizeText, splitStemAndOptions } from "./displayQuestionText";

type HistoryItem = HistoryEntry;

function normalizeAnswer(ans?: string): string {
  if (!ans) return "-";
  const raw = String(ans).trim();
  if (/^[A-D](?:\s*[,，、/|]\s*[A-D])*$/i.test(raw)) {
    const letters = raw.toUpperCase().match(/[A-D]/g);
    if (letters?.length) return Array.from(new Set(letters)).sort().join(",");
  }
  return raw;
}

export function resolveResultAnswerForDisplay(result: ParseResult, dtype: QuestionType, sourceQuestionText = ""): string {
  const raw = String(result.answer || "").trim();
  const effectiveType = inferDisplayAnswerQuestionType(dtype, sourceQuestionText, result);
  if (!looksLikePlaceholderDisplayAnswer(raw) && !shouldReinferChoiceAnswer(raw, effectiveType)) {
    return normalizeAnswer(raw);
  }

  const extracted = extractAnswerFromExplanation(result, effectiveType, sourceQuestionText);
  if (extracted) return extracted;

  return normalizeAnswer(raw || "-");
}

export function isStructuredAnswerExtractionFailed(result: ParseResult): boolean {
  const raw = String(result.answer || "").trim();
  const brief = String(result.briefExplanation || "").trim();
  return looksLikePlaceholderDisplayAnswer(raw) || looksLikeNarrativeCodeDisplayAnswer(raw) || /解析提取失败/.test(brief);
}

export function normalizeHistoryAnswer(entry: HistoryItem, dtype: QuestionType): string {
  const normalized = resolveResultAnswerForDisplay(entry.result, dtype, entry.result.recognizedText || entry.block.previewText || "");
  const looksChoiceLetters = /^[A-D](?:\s*[,，、/|]\s*[A-D])*$/.test(normalized);
  const text = normalizeText(`${entry.result.recognizedText || ""} ${entry.block.previewText || ""}`);
  const looksMultiPart = /\(\s*1\s*\)|（\s*1\s*）|请据图回答|填空|____|________/.test(text);

  if ((dtype === "fill_blank" || dtype === "short_answer" || dtype === "unknown") && looksChoiceLetters && looksMultiPart) {
    const extracted = extractAnswerFromExplanation(entry.result, dtype, entry.result.recognizedText || entry.block.previewText || "");
    return extracted || normalized;
  }
  return normalized;
}

function looksLikePlaceholderDisplayAnswer(answer: string): boolean {
  return /(见分点答案|见分点作答|按分点作答|分点作答|仅供参考|参考答案见解析|详见解析|示例答案|需人工确认|未提取到稳定答案|解析提取失败)/.test(String(answer || "").trim());
}

function looksLikeNarrativeCodeDisplayAnswer(answer: string): boolean {
  const text = String(answer || "").trim();
  if (!text) return false;
  if (/[;{}#]/.test(text)) return false;
  if (/(?:^|\n)\s*(?:1[.)、:]|2[.)、:]|3[.)、:]|一[、.]|二[、.]|三[、.])\s*(?:函数|实现|思路|要点|步骤|说明|参考实现|完整参考实现)/.test(text)) {
    return true;
  }
  return /(函数功能|实现要点|参考实现|完整参考实现如\s*answer\s*所示|已按小问分点整理答案)/.test(text);
}

function extractAnswerFromExplanation(result: ParseResult, dtype: QuestionType, sourceQuestionText = ""): string {
  const source = `${result.briefExplanation || ""}\n${result.detailedExplanation || ""}`.trim();
  if (!source) return "";

  const choiceHintText = `${String(result.recognizedText || "")}\n${source}`;
  const looksChoiceQuestion =
    dtype === "single_choice"
    || dtype === "multi_choice"
    || dtype === "unknown"
    || /[A-D][\.\):：、].+[A-D][\.\):：、]/s.test(choiceHintText)
    || /对应选项|故选|选项[A-F]|答案(?:应)?为|正确答案(?:应)?为/.test(source);

  if (looksChoiceQuestion) {
    const choiceMatch = source.match(
      /(?:故选|因此选|所以选|选(?:择)?|对应选项|答案(?:应)?为|正确答案(?:应)?为)\s*[:：]?\s*([A-F](?:\s*[,，、/|]\s*[A-F])*)/i,
    );
    if (choiceMatch?.[1]) return normalizeAnswer(choiceMatch[1].replace(/\s+/g, ""));

    const summarizedSet = extractSummarizedChoiceSetFromExplanation(source, dtype);
    if (summarizedSet) return summarizedSet;

    const tailChoiceMatch = source.match(/(?:对应|属于|应选)\s*选项\s*([A-F])/i);
    if (tailChoiceMatch?.[1]) return normalizeAnswer(tailChoiceMatch[1]);

    const judgedChoiceMatch = inferChoiceAnswerByOptionJudgement(sourceQuestionText || result.recognizedText || "", source, dtype);
    if (judgedChoiceMatch) return judgedChoiceMatch;

    const matchedByOptionText = inferChoiceAnswerByOptionText(sourceQuestionText || result.recognizedText || "", source, dtype);
    if (matchedByOptionText) return matchedByOptionText;
  }

  if (dtype === "judge") {
    const judgeMatch = source.match(/(?:故选|判断为|答案(?:应)?为|正确答案(?:应)?为)\s*[:：]?\s*(对|错|正确|错误|true|false)/i);
    if (judgeMatch?.[1]) return judgeMatch[1];
  }

  const numbered = Array.from(
    source.matchAll(/(?:^|[\n；;])\s*(?:\(?(\d+)\)?[.)、]|第\s*(\d+)\s*空)\s*[:：]?\s*([^\n；;]+)/g),
  )
    .map((match) => String(match[3] || "").trim())
    .filter((part) => part && part.length <= 80 && !/因为|所以|解析|步骤|首先|其次/.test(part));
  if (numbered.length) return numbered.join("；");

  if (!looksChoiceQuestion && dtype !== "judge") {
    const labeled = source.match(/(?:答案(?:应)?为|正确答案(?:应)?为)\s*[:：]\s*([^\n]+)/);
    if (labeled?.[1]) {
      const line = labeled[1].trim();
      if (line && line.length <= 120) return line;
    }
  }

  return "";
}

function extractSummarizedChoiceSetFromExplanation(source: string, dtype: QuestionType): string {
  const text = String(source || "");
  if (!text) return "";

  const summaryPattern =
    /(?:因此|所以|综上|可见|故|由此可见)?\s*([A-F](?:\s*[,，、/|]\s*[A-F]){1,5})\s*(?:四项|三项|两项|以上各项|各项)?\s*(?:均)?(?:正确|符合题意|符合要求|应选|入选|当选|为正确答案|都是正确的|均为.*?(?:特征|内容|原因|条件))/i;
  const summaryMatch = text.match(summaryPattern);
  if (summaryMatch?.[1]) return normalizeAnswer(summaryMatch[1].replace(/\s+/g, ""));

  if (dtype !== "multi_choice") return "";

  const listedAllCorrectPattern =
    /([A-F](?:\s*[,，、/|]\s*[A-F]){1,5})\s*(?:均|都)(?:正确|符合题意|符合要求|应选|可选|入选)/i;
  const listedAllCorrectMatch = text.match(listedAllCorrectPattern);
  if (listedAllCorrectMatch?.[1]) return normalizeAnswer(listedAllCorrectMatch[1].replace(/\s+/g, ""));

  return "";
}

function shouldReinferChoiceAnswer(answer: string, dtype: QuestionType): boolean {
  if (!(dtype === "single_choice" || dtype === "multi_choice")) return false;
  return !/^[A-D](?:\s*[,，、/|]\s*[A-D])*$/i.test(String(answer || "").trim());
}

function inferDisplayAnswerQuestionType(dtype: QuestionType, sourceQuestionText: string, result: ParseResult): QuestionType {
  if (dtype === "single_choice" || dtype === "multi_choice" || dtype === "judge") return dtype;

  const sourceText = `${sourceQuestionText || ""}\n${result.recognizedText || ""}`;
  const { options } = splitStemAndOptions(sourceText);
  if (options.length >= 4) return "single_choice";
  if (options.length >= 2) return "multi_choice";
  return dtype;
}

function inferChoiceAnswerByOptionText(sourceQuestionText: string, explanationText: string, dtype: QuestionType): string {
  const { options } = splitStemAndOptions(sourceQuestionText);
  if (!options.length) return "";

  const normalizedExplanation = normalizeMatchText(explanationText);
  const matches = options
    .map((option) => {
      const normalizedValue = normalizeMatchText(option.value);
      if (!normalizedValue || normalizedValue.length < 1) return null;
      const hit = explanationContainsOption(normalizedExplanation, normalizedValue);
      if (!hit) return null;
      return { key: option.key, value: normalizedValue, score: normalizedValue.length };
    })
    .filter((item): item is { key: string; value: string; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  if (!matches.length) return "";
  if (dtype === "multi_choice") {
    return Array.from(new Set(matches.map((item) => item.key))).sort().join(",");
  }
  const uniqueKeys = Array.from(new Set(matches.map((item) => item.key)));
  if (uniqueKeys.length !== 1) return "";
  if ((matches[0]?.score ?? 0) < 4) return "";
  return matches[0]?.key || "";
}

function inferChoiceAnswerByOptionJudgement(sourceQuestionText: string, explanationText: string, dtype: QuestionType): string {
  if (dtype !== "single_choice" && dtype !== "multi_choice") return "";

  const stem = normalizeText(sourceQuestionText || "");
  const verdicts = extractOptionJudgementVerdicts(explanationText);
  if (!verdicts.length) return "";

  const positiveKeys = verdicts.filter((item) => item.verdict === "positive").map((item) => item.key);
  const negativeKeys = verdicts.filter((item) => item.verdict === "negative").map((item) => item.key);

  if (dtype === "multi_choice") {
    return positiveKeys.length ? Array.from(new Set(positiveKeys)).sort().join(",") : "";
  }

  if (isNegativeChoiceStem(stem) && negativeKeys.length === 1) return negativeKeys[0] || "";
  if (isPositiveChoiceStem(stem) && positiveKeys.length === 1) return positiveKeys[0] || "";
  if (!isNegativeChoiceStem(stem) && positiveKeys.length === 1 && negativeKeys.length >= 1) return positiveKeys[0] || "";
  if (!isPositiveChoiceStem(stem) && negativeKeys.length === 1 && positiveKeys.length >= 1) return negativeKeys[0] || "";

  return "";
}

function extractOptionJudgementVerdicts(text: string): Array<{ key: string; verdict: "positive" | "negative" }> {
  const source = String(text || "");
  if (!source) return [];

  const verdicts = new Map<string, "positive" | "negative">();
  const positiveRe = /([A-F])\s*(?:项|选项)?\s*(?:是|为)?\s*(正确|对|符合题意|符合要求|成立|可行|恰当|合理|无误|正确的)/gi;
  const negativeRe = /([A-F])\s*(?:项|选项)?\s*(?:是|为)?\s*(错误|错|不正确|不对|不符合题意|不符合要求|不成立|不可行|不恰当|不合理|有误)/gi;

  for (const match of source.matchAll(negativeRe)) {
    const key = match[1]?.toUpperCase();
    if (key) verdicts.set(key, "negative");
  }
  for (const match of source.matchAll(positiveRe)) {
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

function explanationContainsOption(explanation: string, optionValue: string): boolean {
  if (!optionValue) return false;
  if (optionValue.length <= 3) {
    const escaped = escapeRegex(optionValue);
    return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, "i").test(explanation);
  }
  return explanation.includes(optionValue);
}

function normalizeMatchText(text: string): string {
  return String(text || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]{}<>《》“”"'`~!@#$%^&*+=|\\/:;,.?，。；：、·—\-]/g, "");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getDisplayType(entry: HistoryItem): QuestionType {
  const text = normalizeText(entry.result.recognizedText || entry.block.previewText || "");
  const optionCount = (text.match(/[A-D][\.\):：、]/g) || []).length;
  const strongChoiceFromText = optionCount >= 4;

  if (strongChoiceFromText) {
    const blockType = entry.block.questionTypeGuess;
    if (blockType === "single_choice" || blockType === "multi_choice") return blockType;
    return "single_choice";
  }

  const t1 = entry.result.questionType;
  if (t1 && ["single_choice", "multi_choice", "judge", "fill_blank", "short_answer", "unknown"].includes(t1)) {
    return t1 as QuestionType;
  }
  const t2 = entry.block.questionTypeGuess;
  if (t2 && ["single_choice", "multi_choice", "judge", "fill_blank", "short_answer", "unknown"].includes(t2)) {
    return t2 as QuestionType;
  }
  if (/判断|对错|正确|错误|true|false/i.test(text)) return "judge";
  if (/填空|____|___/.test(text)) return "fill_blank";
  if (optionCount >= 4) return "single_choice";
  if (optionCount >= 2) return "multi_choice";
  return "unknown";
}
