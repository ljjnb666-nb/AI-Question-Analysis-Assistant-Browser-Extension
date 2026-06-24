import type { ParseResult } from "@/shared/types";

const JUDGE_TRUE_KEYS = ["\u5bf9", "\u6b63\u786e", "true", "t", "yes", "y"];
const JUDGE_FALSE_KEYS = ["\u9519", "\u9519\u8bef", "false", "f", "no", "n"];
const UNSAFE_TEXT_ANSWER_MARKERS = [
  "\u89c1\u5206\u70b9\u7b54\u6848",
  "\u793a\u4f8b\u7b54\u6848",
  "\u9700\u4eba\u5de5\u786e\u8ba4",
];
const STRUCTURED_FILL_NOISE_RE =
  /\u9700\u4eba\u5de5\u786e\u8ba4|\u89c1\u5206\u70b9\u7b54\u6848|\u793a\u4f8b\u7b54\u6848|\u65e0\u6cd5\u5224\u65ad|\u65e0\u6cd5\u786e\u5b9a|\u9898\u5e72\u4e0d\u5b8c\u6574|\u4fe1\u606f\u4e0d\u8db3/;
const EXPLANATION_TEXT_RE =
  /\u56e0\u4e3a|\u6240\u4ee5|\u8bf4\u660e|\u89e3\u6790|\u7406\u7531|\u6b65\u9aa4|\u9996\u5148|\u5176\u6b21/;
const SUBSCRIPT_DIGITS = "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089";
const SUPERSCRIPT_DIGITS = "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079";

export function splitAnswerParts(answer: string, expectedCount: number): string[] {
  const normalized = String(answer || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const numberedMatches = Array.from(
    normalized.matchAll(
      /(?:^|[\n;；])\s*(?:(\d+\.\d+)\s*[:：]?\s*|\(?(\d+)\)?[.)、]\s*|第\s*(\d+)\s*空\s*[:：]?\s*)\s*([^\n;；]+)/g,
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
    if (JUDGE_TRUE_KEYS.some((key) => normalized.includes(key))) return ["\u5bf9"];
    if (JUDGE_FALSE_KEYS.some((key) => normalized.includes(key))) return ["\u9519"];
    return [];
  }

  const letters = raw.toUpperCase().match(/[A-Z]/g) || [];
  return Array.from(new Set(letters.filter((letter) => letter >= "A" && letter <= "F"))).sort();
}

export function buildControlValues(parts: string[], count: number, fallbackAnswer: string): string[] {
  if (parts.length >= count) return parts.slice(0, count);

  if (parts.length === 1 && count > 1) {
    const splitMore = parts[0]
      .split(/[，,|/、]+/)
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

export function formatSingleTextAnswer(answer: string, questionType: ParseResult["questionType"]): string {
  if (questionType === "short_answer") return String(answer || "").trim();
  return normalizeFilledPart(cleanAnswerPart(answer));
}

export function shouldUseDetailedAnswer(answer: string): boolean {
  const normalized = String(answer || "").trim();
  return !normalized || UNSAFE_TEXT_ANSWER_MARKERS.includes(normalized);
}

export function resolveTextAnswerSource(
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

export function looksStructuredTextAnswer(
  parts: string[],
  source: string,
  controlCount: number,
  questionType: ParseResult["questionType"],
): boolean {
  if (!parts.length) return false;
  if (STRUCTURED_FILL_NOISE_RE.test(source)) return false;
  if (parts.some((part) => EXPLANATION_TEXT_RE.test(part))) return false;

  if (questionType === "fill_blank" && controlCount > 1) {
    if (parts.length < controlCount) return false;
    if (parts.slice(0, controlCount).some((part) => part.length > 60)) return false;
  }

  return true;
}

export function cleanAnswerPart(part: string): string {
  return String(part || "")
    .replace(/^(?:\d+\.\d+\s*[:：]?|\(?\d+\)?[.)、]|第\s*\d+\s*空\s*[:：]?|空\s*\d+\s*[:：]?|答案?\s*\d+\s*[:：]?)\s*/, "")
    .replace(/^[:：\s]*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeFilledPart(part: string): string {
  return String(part || "")
    .replace(/^\d+\s*[:：、.\s]\s*/, "")
    .trim();
}

export function inferTypeFromAnswer(
  scope: Element,
  answer: string,
  textInputSelector: string,
  choiceInputSelector: string,
  optionRowSelector: string,
  normalizeText: (text: string) => string,
): ParseResult["questionType"] {
  const textControls = scope.querySelectorAll(textInputSelector).length;
  const choiceControls = scope.querySelectorAll(choiceInputSelector).length;

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

  const optionLikeRows = Array.from(scope.querySelectorAll(optionRowSelector))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map((node) => normalizeText(node.innerText || node.textContent || ""))
    .filter(Boolean);
  const judgeRows = optionLikeRows.filter((text) => /^(?:对|错|正确|错误|true|false)$/i.test(text));
  if (judgeRows.length >= 2) return "judge";

  const letterRows = optionLikeRows.filter((text) => /^(?:[A-F])[\.\):：、\s]/i.test(text));
  if (letterRows.length >= 4) return "single_choice";
  if (letterRows.length >= 2) return "multi_choice";

  return "unknown";
}

export function inferChoiceKeysFromContent(
  result: ParseResult,
  questionType: ParseResult["questionType"],
  candidates: Array<{ key: string; labelText: string }>,
): string[] {
  if (!candidates.length || questionType === "judge") return [];

  const sources = [
    String(result.answer || "").trim(),
    String(result.briefExplanation || "").trim(),
    String(result.detailedExplanation || "").trim(),
  ]
    .map(normalizeMatchingText)
    .filter(Boolean);
  if (!sources.length) return [];

  const scored: Array<{ key: string; score: number }> = [];

  for (const candidate of candidates) {
    const label = normalizeOptionLabelText(candidate.labelText);
    if (!label) continue;

    let best = 0;
    for (const source of sources) {
      if (!source) continue;
      if (source === label) best = Math.max(best, 300);
      if (source.includes(label) && label.length >= 2) best = Math.max(best, 180 + Math.min(label.length, 60));
      if (label.includes(source) && source.length >= 4) best = Math.max(best, 120 + Math.min(source.length, 60));
    }

    if (best > 0) {
      scored.push({ key: candidate.key, score: best });
    }
  }

  if (!scored.length) return [];

  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const threshold = Math.max(160, (scored[0]?.score ?? 0) - 40);
  return Array.from(new Set(scored.filter((item) => item.score >= threshold).map((item) => item.key)));
}

export function extractChoiceKeysFromExplanations(
  result: ParseResult,
  questionType: ParseResult["questionType"],
): string[] {
  if (questionType === "judge") return [];

  const source = [result.answer, result.briefExplanation, result.detailedExplanation]
    .map((item) => String(item || ""))
    .join("\n");

  const explicit = Array.from(source.matchAll(/(?:选项|答案|选择|选)\s*([A-F])/gi))
    .map((match) => match[1]?.toUpperCase())
    .filter((value): value is string => Boolean(value));
  if (explicit.length) return Array.from(new Set(explicit));

  const loose = Array.from(source.matchAll(/\b([A-F])\b/g))
    .map((match) => match[1]?.toUpperCase())
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(loose));
}

export function inferRowKey(
  text: string,
  questionType: ParseResult["questionType"],
  normalizeText: (text: string) => string,
): string | null {
  const normalized = normalizeText(text);

  if (questionType === "judge") {
    if (/^(?:对|正确|true)\b/i.test(normalized) || /(?:^|\s)(?:对|正确|true)(?:\s|$)/i.test(normalized)) return "\u5bf9";
    if (/^(?:错|错误|false)\b/i.test(normalized) || /(?:^|\s)(?:错|错误|false)(?:\s|$)/i.test(normalized)) return "\u9519";
    return null;
  }

  const match = normalized.match(/(?:^|\s)([A-F])[\.\):：、\s]/i);
  return match?.[1]?.toUpperCase() ?? null;
}

export function normalizeOptionLabelText(text: string): string {
  return normalizeMatchingText(
    String(text || "")
      .replace(/^(?:[A-F]|[A-F][\.\):：、])\s*/i, "")
      .trim(),
  );
}

export function normalizeMatchingText(text: string): string {
  return String(text || "")
    .replace(/[\u2080-\u2089]/g, (char) => String(SUBSCRIPT_DIGITS.indexOf(char)))
    .replace(/[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]/g, (char) => {
      const index = SUPERSCRIPT_DIGITS.indexOf(char);
      return index >= 0 ? `^${index}` : char;
    })
    .replace(/[\s,，。；;！？（）()[\]【】{}]/g, "")
    .replace(/[·•]/g, "")
    .replace(/[＝=]/g, "=")
    .replace(/[－—–-]/g, "-")
    .replace(/[×xX]/g, "*")
    .replace(/[÷/]/g, "/")
    .toLowerCase();
}
