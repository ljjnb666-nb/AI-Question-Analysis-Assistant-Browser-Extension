import type { QuestionType } from "@/shared/types";

export const OPTION_RE = /[A-D][\.\):\uFF1A\u3001]/g;
export const CIRCLED_RE = /[\u2460\u2461\u2462\u2463]/g;
export const QUESTION_RE = /[?\uFF1F]|下列|哪项|正确的是|错误的是|属于|不属于/;
const JUDGE_HEADER_RE = /\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)/g;
const JUDGE_HEADER_START_RE = /\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?/;

export function normalizeText(raw: string): string {
  return normalizeMathDisplayText(stripSvgCssNoise(String(raw || "")).replace(/\s+/g, " ").trim());
}

export function inferQuestionType(text: string): QuestionType {
  const t = text.toLowerCase();
  if (["不定项", "多选", "multiple choice", "select all", "all that apply"].some((k) => t.includes(k))) return "multi_choice";
  if (["单选", "single choice", "single-select"].some((k) => t.includes(k))) return "single_choice";
  if (/(填空|blank|请输入答案|_{3,}|[（(]\s*\d+\s*[)）])/.test(text)) return "fill_blank";
  const optCount = countOptionMarkersInText(text);
  if (optCount >= 2) {
    return optCount >= 4 ? "single_choice" : "multi_choice";
  }
  if (isJudgeLikeText(text)) return "judge";
  if (optCount >= 4) return "single_choice";
  if (optCount >= 2) return "multi_choice";
  return "unknown";
}

export function isJudgeLikeText(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  if (/[（(]\s*[√×TF对错]\s*[)）]/i.test(t)) return true;
  if (/(判断题|是非题|判断下列|判断正误|判断对错)/i.test(t)) return true;
  if (/\b(true|false|t\/f)\b/i.test(t)) return true;
  return false;
}

export function countOptionMarkersInText(text: string): number {
  const normalized = normalizeText(text);
  const letterOptions = normalized.match(OPTION_RE) || [];
  const circled = normalized.match(CIRCLED_RE) || [];
  return letterOptions.length + circled.length;
}

export function countBlankMarkersInText(text: string): number {
  const normalized = normalizeText(text);
  const underscore = normalized.match(/_{3,}|—{2,}|﹍{2,}/g) || [];
  const numbered = normalized.match(/(?:\d+\.\d+|[（(]\d+[)）])/g) || [];
  return underscore.length + numbered.length;
}

export function hasStrongQuestionSignal(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  const optionCount = (t.match(OPTION_RE) || []).length + (t.match(CIRCLED_RE) || []).length;
  if (optionCount >= 3) return true;
  if (QUESTION_RE.test(t)) return true;
  if (isJudgeLikeText(t)) return true;
  if (/(?:_{2,}|填写|blank|简答|材料题|请输入答案)/i.test(t)) return true;
  return false;
}

export function sanitizePreviewTextByType(text: string, type: QuestionType): string {
  const normalized = sanitizePreviewText(text);
  if (!normalized) return "";
  if (type === "single_choice" || type === "multi_choice") {
    return sanitizeChoicePreviewText(normalized);
  }
  if (type === "judge") {
    return sanitizeJudgePreviewText(normalized);
  }
  return normalized;
}

export function sanitizeChoicePreviewText(text: string): string {
  const normalized = sanitizePreviewText(text);
  if (!normalized) return "";

  const firstOptionIdx = normalized.search(/[A-D][\.\):\uFF1A\u3001]/);
  if (firstOptionIdx < 0) return trimTrailingQuestionMarker(normalized);

  const stem = trimTrailingQuestionMarker(normalizeText(normalized.slice(0, firstOptionIdx)));
  const optionSegment = normalized.slice(firstOptionIdx);
  const rawMatches = Array.from(optionSegment.matchAll(/([A-D])[\.\):\uFF1A\u3001]\s*([\s\S]*?)(?=(?:\s+[A-D][\.\):\uFF1A\u3001])|$)/g));
  const dedup = new Map<string, string>();
  for (const match of rawMatches) {
    const key = match[1];
    const value = sanitizeChoiceOptionValue(match[2] || "");
    if (!value) continue;
    if (!dedup.has(key)) dedup.set(key, value);
  }

  if (dedup.size < 2) return trimTrailingQuestionMarker(normalized);
  const rebuiltOptions = [...dedup.entries()].map(([key, value]) => `${key}. ${value}`).join(" ");
  return normalizeText(`${stem} ${rebuiltOptions}`);
}

export function trimTrailingQuestionMarker(text: string): string {
  let out = normalizeText(text);
  if (!out) return "";

  out = out
    .replace(/\s+[一二三四五六七八九十]+、\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]?(?:单选题|多选题|判断题|填空题)?[\]】]?\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]\s*$/u, "")
    .replace(/\s+第\s*[一二三四五六七八九十\d]+\s*[章节题]\s*$/u, "")
    .trim();

  return out;
}

export function normalizeMathDisplayText(text: string): string {
  let out = String(text || "");
  if (!out) return "";

  out = out
    .replace(/&infin;|&#8734;|\\infty/gi, "∞")
    .replace(/负无穷/g, "-∞")
    .replace(/正无穷/g, "+∞")
    .replace(/&omega;|&#969;|\\omega/gi, "ω")
    .replace(/&sigma;|&#963;|\\sigma/gi, "σ")
    .replace(/&minus;|&#8722;/gi, "-")
    .replace(/[−﹣－]/g, "-")
    .replace(/[＋﹢]/g, "+")
    .replace(/\b([+-])\s*infty\b/gi, "$1∞")
    .replace(/\binfty\b/gi, "∞")
    .replace(/由\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/g, "由-∞到+∞")
    .replace(/从\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/g, "从-∞到+∞");

  out = out.replace(
    /((?:ω|w|omega)[^。；;,.，]{0,24}?由)\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/gi,
    (_m, prefix) => `${prefix}-∞到+∞`,
  );

  return out;
}

export function stripSvgCssNoise(text: string): string {
  let out = String(text || "");
  if (!out) return "";

  out = out
    .replace(/\.[A-Za-z0-9_-]+\s+\.[A-Za-z0-9_-]+\s*\{[^{}]{0,240}\}/g, " ")
    .replace(/\b(?:fill|stroke|stroke-width|stroke-linejoin|stroke-linecap|font-size|font-family|font-style|font-weight)\s*:\s*[^;}{]{1,120};?/gi, " ")
    .replace(/\s{2,}/g, " ");

  return out.trim();
}

export function decodeFormulaLikeText(raw: string): string {
  let out = String(raw || "");
  if (!out) return "";
  try {
    out = decodeURIComponent(out);
  } catch {
    // keep raw text
  }

  out = out
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "$1/$2")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\omega/g, "ω")
    .replace(/\\sigma/g, "σ")
    .replace(/\\infty/g, "∞")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s*([=+\-*/])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeMathDisplayText(out);
}

export function sanitizePreviewText(text: string): string {
  let out = normalizeText(text);
  if (!out) return "";

  const headNoise = /^(?:返回|作业详情|提交作业|上一题|下一题|标记此题|课堂练习|总分|题目数|答题卡|截止时间)\s*/;
  while (headNoise.test(out)) {
    out = out.replace(headNoise, "").trim();
  }

  const questionStart = out.search(/(?:\d{1,3}\s*[\.、\)）]|第\s*\d{1,3}\s*题|[A-D][\.\):\uFF1A\u3001])/);
  if (questionStart > 0) {
    const prefix = out.slice(0, questionStart);
    if (/返回|作业详情|提交作业|课堂练习|总分|题目数|答题卡|截止时间|单选题|多选题|判断题|填空题/.test(prefix)) {
      out = out.slice(questionStart).trim();
    }
  }

  return out;
}

export function sanitizeJudgePreviewText(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (!/\[?判断题\]?|(?:对|错|正确|错误)/.test(normalized)) return normalized;

  let out = normalized;
  const headers = Array.from(out.matchAll(JUDGE_HEADER_RE));
  const start = headers[0]?.index ?? out.search(JUDGE_HEADER_START_RE);
  if (start > 0) out = out.slice(start).trim();
  if (headers.length >= 2 && typeof headers[1].index === "number") {
    const secondIndex = headers[1].index!;
    if (secondIndex > 0) out = out.slice(0, secondIndex).trim();
  }

  const noise = /(?:上一题|下一题|提交作业|标记此题|返回|答题卡|课堂练习)/;
  const noiseMatch = noise.exec(out);
  if (noiseMatch && noiseMatch.index > 0) {
    out = out.slice(0, noiseMatch.index).trim();
  }

  const stem = dedupeRepeatedJudgeStem(extractJudgeStemCore(out));
  const hasDui = /(?:^|\s)对(?:\s|$)|正确|\btrue\b/i.test(out);
  const hasCuo = /(?:^|\s)错(?:\s|$)|错误|\bfalse\b/i.test(out);

  out = stem;
  if (hasDui) out += " 对";
  if (hasCuo) out += " 错";

  return out;
}

export function extractJudgeStemCore(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "";

  const explicitSentence = normalized.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*.*?[。！？!?])/);
  if (explicitSentence?.[1]) return normalizeText(explicitSentence[1]);

  const cutAtOption = normalized.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*.*?)(?=\s+(?:对|错|正确|错误|true|false)\b)/i);
  if (cutAtOption?.[1]) return normalizeText(cutAtOption[1]);

  return normalized;
}

export function dedupeRepeatedJudgeStem(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "";

  const headerMatch = normalized.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*)(.+)$/);
  if (!headerMatch) return normalized;

  const header = headerMatch[1];
  const body = headerMatch[2].trim();
  if (!body) return normalized;

  const firstOptionAt = body.search(/\b(?:对|错|正确|错误|true|false)\b/i);
  const leadStem = normalizeText((firstOptionAt > 0 ? body.slice(0, firstOptionAt) : body).trim());
  if (leadStem.length >= 8) {
    const repeatedLeadAt = body.indexOf(leadStem, leadStem.length);
    if (repeatedLeadAt > 0) {
      return normalizeText(`${header}${body.slice(0, repeatedLeadAt).trim()}`);
    }
  }

  const firstSentence = body.match(/^(.{6,}?[。！？!?])/);
  if (firstSentence?.[1]) {
    const sentence = normalizeText(firstSentence[1]);
    const secondIndex = body.indexOf(sentence, sentence.length);
    if (secondIndex > 0) {
      return normalizeText(`${header}${body.slice(0, secondIndex).trim()}`);
    }
  }

  const probe = normalizeText(body.slice(0, Math.min(24, Math.max(12, Math.floor(body.length / 2)))));
  if (probe.length >= 12) {
    const repeatedAt = body.indexOf(probe, probe.length);
    if (repeatedAt > 0) {
      return normalizeText(`${header}${body.slice(0, repeatedAt).trim()}`);
    }
  }

  return normalizeText(`${header}${body}`);
}

function sanitizeChoiceOptionValue(raw: string): string {
  let out = normalizeText(raw);
  if (!out) return "";

  const noisePattern = /(?:返回|作业详情|提交作业|上一题|下一题|标记此题|课堂练习|总分|题目数|答题卡|截止时间|在线客服|文件预览|submit|previous|next)/i;
  const noiseMatch = noisePattern.exec(out);
  if (noiseMatch && noiseMatch.index > 0) {
    out = normalizeText(out.slice(0, noiseMatch.index));
  }

  return trimTrailingQuestionMarker(out);
}
