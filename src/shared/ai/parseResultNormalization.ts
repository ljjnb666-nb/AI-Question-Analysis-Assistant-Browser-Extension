import type { ParseResult, QuestionBlock } from "../types";

export function sanitizeModelText(input: string): string {
  const text = String(input || "").replace(/\r/g, "");
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isModelNoiseLine(line));
  const merged = lines.join("\n");
  return stripModelTrailingNoise(merged);
}

export function normalizeRecognizedQuestionText(
  text: string,
  questionType: ParseResult["questionType"],
  guessedType: QuestionBlock["questionTypeGuess"],
): string {
  const normalized = sanitizeModelText(text);
  if (!normalized) return "";

  const effectiveType = questionType === "unknown" ? guessedType : questionType;
  if (effectiveType === "single_choice" || effectiveType === "multi_choice") {
    return normalizeChoiceRecognizedText(normalized);
  }
  if (effectiveType === "judge") {
    return normalizeJudgeRecognizedText(normalized);
  }
  if (effectiveType === "fill_blank") {
    return normalizeFillBlankRecognizedText(normalized);
  }
  return trimTrailingQuestionNoise(normalized);
}

function normalizeChoiceRecognizedText(text: string): string {
  const normalized = trimTrailingQuestionNoise(text);
  const firstOptionIdx = normalized.search(/[A-D][\.\):：、]/);
  if (firstOptionIdx < 0) return normalized;

  const stem = dedupeRepeatedLead(normalizeTextLoose(normalized.slice(0, firstOptionIdx)));
  const optionSegment = normalized.slice(firstOptionIdx);
  const rawMatches = Array.from(optionSegment.matchAll(/([A-D])[\.\):：、]\s*([\s\S]*?)(?=(?:\s+[A-D][\.\):：、])|$)/g));
  const dedup = new Map<string, string>();
  for (const match of rawMatches) {
    const key = match[1];
    const value = sanitizeRecognizedOptionValue(match[2] || "");
    if (!value) continue;
    if (!dedup.has(key)) dedup.set(key, value);
  }
  if (dedup.size < 2) return normalized;
  return normalizeTextLoose(`${stem} ${Array.from(dedup.entries()).map(([key, value]) => `${key}. ${value}`).join(" ")}`);
}

function normalizeJudgeRecognizedText(text: string): string {
  let out = trimTrailingQuestionNoise(text);
  const headerMatches = Array.from(out.matchAll(/\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)/g));
  const firstHeaderIndex = headerMatches[0]?.index ?? -1;
  if (firstHeaderIndex > 0) out = out.slice(firstHeaderIndex).trim();
  if (headerMatches.length >= 2 && typeof headerMatches[1].index === "number") {
    out = out.slice(0, headerMatches[1].index!).trim();
  }

  const optionAt = out.search(/\b(?:对|错|正确|错误|true|false)\b/i);
  const stem = dedupeRepeatedLead(normalizeTextLoose(optionAt > 0 ? out.slice(0, optionAt) : out));
  const options: string[] = [];
  if (/\btrue\b|\bfalse\b/i.test(out)) {
    options.push("True", "False");
  } else {
    if (/(?:^|\s)(?:对|正确)(?:\s|$)/.test(out)) options.push("对");
    if (/(?:^|\s)(?:错|错误)(?:\s|$)/.test(out)) options.push("错");
  }
  return normalizeTextLoose(`${stem}${options.length ? ` ${Array.from(new Set(options)).join(" ")}` : ""}`);
}

function normalizeFillBlankRecognizedText(text: string): string {
  const normalized = trimTrailingQuestionNoise(text).replace(/请输入答案/g, " ").replace(/\s+/g, " ").trim();
  return dedupeRepeatedLead(normalized);
}

function sanitizeRecognizedOptionValue(raw: string): string {
  const normalized = trimTrailingQuestionNoise(raw);
  return dedupeRepeatedLead(normalized);
}

function trimTrailingQuestionNoise(text: string): string {
  let out = normalizeTextLoose(text);
  if (!out) return "";

  const noisePattern = /(?:返回|作业详情|提交作业|上一题|下一题|标记此题|课堂练习|总分|题目数|答题卡|在线客服|文件预览|submit|previous|next)/i;
  const noiseMatch = noisePattern.exec(out);
  if (noiseMatch && noiseMatch.index > 0) {
    out = normalizeTextLoose(out.slice(0, noiseMatch.index));
  }

  out = out
    .replace(/\s+[一二三四五六七八九十]+、\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]?(?:单选题|多选题|判断题|填空题)?[\]】]?\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]\s*$/u, "")
    .replace(/\s+第\s*[一二三四五六七八九十\d]+\s*[章节题]\s*$/u, "")
    .trim();

  return out;
}

function dedupeRepeatedLead(text: string): string {
  const normalized = normalizeTextLoose(text);
  if (!normalized) return "";

  const firstSentence = normalized.match(/^(.{8,}?[。！？!?])/);
  if (firstSentence?.[1]) {
    const sentence = normalizeTextLoose(firstSentence[1]);
    const secondIndex = normalized.indexOf(sentence, sentence.length);
    if (secondIndex > 0) {
      return normalizeTextLoose(normalized.slice(0, secondIndex));
    }
  }

  const probe = normalizeTextLoose(normalized.slice(0, Math.min(32, Math.max(12, Math.floor(normalized.length / 2)))));
  if (probe.length >= 12) {
    const repeatedAt = normalized.indexOf(probe, probe.length);
    if (repeatedAt > 0) {
      return normalizeTextLoose(normalized.slice(0, repeatedAt));
    }
  }

  return normalized;
}

export function normalizeTextLoose(text: string): string {
  return normalizeMathDisplayText(String(text || "").replace(/\s+/g, " ").trim());
}

function normalizeMathDisplayText(text: string): string {
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
    /((?:ω|w|omega)[^。；;,.，\n]{0,24}?由)\s*-\s*(?:∞)?\s*到\s*\+\s*(?:∞)?/gi,
    (_m, prefix) => `${prefix}-∞到+∞`,
  );

  return out;
}

function isModelNoiseLine(line: string): boolean {
  const t = String(line || "").trim();
  if (!t) return true;
  if (/^```/.test(t)) return true;
  if (/^(?:\{|\}|\[|\]|"questionType"|"answer"|"confidence"|"recognizedText"|"warning")/.test(t)) return true;
  if (/[.#]?[a-zA-Z0-9_-]+\s*\{\s*(?:fill|stroke|font-family|line-join|linecap|width|height)\s*:/i.test(t)) return true;
  if (/^(?:fill|stroke|font-family|stroke-width|stroke-linejoin|stroke-linecap)\s*:/i.test(t)) return true;
  if (/(?:svg|path|stroke|fill)\s*[:=]/i.test(t) && /[{;}]/.test(t)) return true;
  if (t.length > 150 && /[{;}:]/.test(t) && /(rgb\(|font-family|stroke|fill|brush\d+)/i.test(t)) return true;
  return false;
}

function stripModelTrailingNoise(text: string): string {
  const t = String(text || "");
  if (!t) return t;
  const cutMarkers = ["```json", "```", "{\n\"questionType\"", "\"questionType\":", "[\n{", "\n[{", "\n.A.", "\n.w"];
  let cut = -1;
  for (const marker of cutMarkers) {
    const idx = t.indexOf(marker);
    if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
  }
  return (cut >= 0 ? t.slice(0, cut) : t).trim();
}

/** Strip conversational wrappers ("我来为你写一份…", "希望对你有帮助") around an essay answer.
 * Conservative: only trims leading/trailing paragraphs that match wrapper
 * patterns; the substantive core is never modified. */
export function stripConversationalWrappers(text: string): string {
  const input = String(text || "").replace(/\r/g, "");
  if (!input.trim()) return "";
  const paras = input.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= 1) return input.trim();

  const isPreamble = (p: string): boolean => {
    if (p.length > 80) return false;
    return /^(好的[，,]?|嗯[，,]?|我来为|我将为|以下[是为]?|下面[是为]?|接下来[是为]?|根据(你的|题目|以上)?要求|针对本?题|关于本?题)/.test(p)
      || /^(这里|这[是里])是.{0,20}(方案|答案|正文|内容)[：:]?$/.test(p);
  };
  const isPostscript = (p: string): boolean => {
    if (p.length > 80) return false;
    return /^(希望|祝|加油|以上|如需|如果需要|需要.{0,10}(调整|修改|补充)|总之.{0,10}(希望|祝))/.test(p);
  };
  // A paragraph is substantive if it has essay structure or real length.
  const isSubstantive = (p: string): boolean =>
    p.length > 120
    || /^(一|二|三|四|五|六|七|八|九|十)[、.．:]/.test(p)
    || /^\d+[、.．:）)]/.test(p)
    || /^#{1,3}\s/.test(p)
    || /^[（(](一|二|三|\d+)[）)]/.test(p);

  let start = 0;
  while (start < paras.length - 1 && isPreamble(paras[start]) && !isSubstantive(paras[start])) start++;
  let end = paras.length;
  while (end > start + 1 && isPostscript(paras[end - 1]) && !isSubstantive(paras[end - 1])) end--;
  return paras.slice(start, end).join("\n\n").trim();
}
