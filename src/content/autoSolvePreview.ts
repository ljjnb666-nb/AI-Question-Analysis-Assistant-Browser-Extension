import type { QuestionType } from "@/shared/types";
import { normalizeMathDisplayText } from "./formulaEmbedFallback";

export function pickBestAutoSolvePreviewText(rawText: string, richText: string, typeGuess: QuestionType): string {
  const candidates = [
    sanitizeAutoSolvePreviewText(rawText, typeGuess),
    sanitizeAutoSolvePreviewText(richText, typeGuess),
  ].filter(Boolean);

  if (!candidates.length) return normalizePreviewText(rawText || richText || "");
  if (candidates.length === 1) return candidates[0];

  return candidates
    .map((text) => ({ text, score: scoreAutoSolvePreviewText(text, typeGuess) }))
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length)[0]?.text
    || candidates[0];
}

export function sanitizeAutoSolvePreviewText(text: string, typeGuess: QuestionType): string {
  const normalized = trimAutoSolveQuestionNoise(text);
  if (!normalized) return "";

  if (typeGuess === "single_choice" || typeGuess === "multi_choice") {
    return sanitizeAutoSolveChoicePreview(normalized);
  }
  if (typeGuess === "judge") {
    return sanitizeAutoSolveJudgePreview(normalized);
  }
  if (typeGuess === "fill_blank") {
    return dedupeAutoSolveLead(normalized.replace(/请输入答案/g, " ").replace(/\s+/g, " ").trim());
  }
  return dedupeAutoSolveLead(normalized);
}

function sanitizeAutoSolveChoicePreview(text: string): string {
  const normalized = trimAutoSolveTrailingQuestionStart(trimAutoSolveQuestionNoise(text));
  const firstOptionIdx = normalized.search(/[A-D][\.\):：、]/);
  if (firstOptionIdx < 0) return dedupeAutoSolveLead(normalized);

  const stem = dedupeAutoSolveLead(normalizePreviewText(normalized.slice(0, firstOptionIdx)));
  const optionSegment = normalized.slice(firstOptionIdx);
  const rawMatches = Array.from(optionSegment.matchAll(/([A-D])[\.\):：、]\s*([\s\S]*?)(?=(?:\s+[A-D][\.\):：、])|$)/g));
  const dedup = new Map<string, string>();
  for (const match of rawMatches) {
    const key = match[1];
    const value = trimAutoSolveTrailingQuestionStart(trimAutoSolveQuestionNoise(match[2] || ""));
    if (!value) continue;
    if (!dedup.has(key)) dedup.set(key, dedupeAutoSolveLead(value));
  }

  if (dedup.size < 2) return dedupeAutoSolveLead(normalized);
  return normalizePreviewText(`${stem} ${Array.from(dedup.entries()).map(([key, value]) => `${key}. ${value}`).join(" ")}`);
}

function sanitizeAutoSolveJudgePreview(text: string): string {
  const normalized = trimAutoSolveQuestionNoise(text);
  const firstOptionIdx = normalized.search(/\b(?:对|错|正确|错误|true|false)\b/i);
  const stem = dedupeAutoSolveLead(normalizePreviewText(firstOptionIdx > 0 ? normalized.slice(0, firstOptionIdx) : normalized));
  const options: string[] = [];
  if (/\btrue\b|\bfalse\b/i.test(normalized)) {
    options.push("True", "False");
  } else {
    if (/(?:^|\s)(?:对|正确)(?:\s|$)/.test(normalized)) options.push("对");
    if (/(?:^|\s)(?:错|错误)(?:\s|$)/.test(normalized)) options.push("错");
  }
  return normalizePreviewText(`${stem}${options.length ? ` ${Array.from(new Set(options)).join(" ")}` : ""}`);
}

function trimAutoSolveQuestionNoise(text: string): string {
  let out = normalizePreviewText(text || "");
  if (!out) return "";

  const noisePattern = /(?:返回|作业详情|提交作业|上一题|下一题|标记此题|课堂练习|总分|题目数|答题卡|截止时间|在线客服|文件预览|submit|previous|next)/i;
  const noiseMatch = noisePattern.exec(out);
  if (noiseMatch && noiseMatch.index > 0) {
    out = normalizePreviewText(out.slice(0, noiseMatch.index));
  }

  return out
    .replace(/\s+[一二三四五六七八九十]+、\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]?(?:单选题|多选题|判断题|填空题)?[\]】]?\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]\s*$/u, "")
    .replace(/\s+第\s*[一二三四五六七八九十\d]+\s*[章节题]\s*$/u, "")
    .trim();
}

function trimAutoSolveTrailingQuestionStart(text: string): string {
  const normalized = normalizePreviewText(text || "");
  if (!normalized) return "";

  const headerMatch = /\s+\d{1,3}\s*[\.、)\]]\s*(?:单选题|多选题|判断题|填空题)/.exec(normalized);
  if (headerMatch && typeof headerMatch.index === "number" && headerMatch.index > 0) {
    return normalizePreviewText(normalized.slice(0, headerMatch.index));
  }

  const sectionMatch = /\s+[一二三四五六七八九十]+、\s*(?:单选题|多选题|判断题|填空题)/.exec(normalized);
  if (sectionMatch && typeof sectionMatch.index === "number" && sectionMatch.index > 0) {
    return normalizePreviewText(normalized.slice(0, sectionMatch.index));
  }

  return normalized;
}

function dedupeAutoSolveLead(text: string): string {
  const normalized = normalizePreviewText(text || "");
  if (!normalized) return "";

  const firstSentence = normalized.match(/^(.{8,}?[。！？!?])/);
  if (firstSentence?.[1]) {
    const sentence = normalizePreviewText(firstSentence[1]);
    const secondIndex = normalized.indexOf(sentence, sentence.length);
    if (secondIndex > 0) return normalizePreviewText(normalized.slice(0, secondIndex));
  }

  const probe = normalizePreviewText(normalized.slice(0, Math.min(32, Math.max(12, Math.floor(normalized.length / 2)))));
  if (probe.length >= 12) {
    const repeatedAt = normalized.indexOf(probe, probe.length);
    if (repeatedAt > 0) return normalizePreviewText(normalized.slice(0, repeatedAt));
  }

  return normalized;
}

function scoreAutoSolvePreviewText(text: string, typeGuess: QuestionType): number {
  const normalized = normalizePreviewText(text || "");
  if (!normalized) return -1_000;

  let score = Math.min(normalized.length, 800);
  score += (normalized.match(/[A-D][\.\):：、]/g) || []).length * 12;
  score += (normalized.match(/_{3,}|—{2,}|﹍{2,}|\d+\.\d+/g) || []).length * 18;
  if (/(?:∞|omega|ω|sigma|σ|G\(s\)|H\(s\)|G\(j\)|H\(j\)|传递函数|奈奎斯特|伯德图)/i.test(normalized)) score += 30;

  const repeatedHeaders = normalized.match(/\d{1,3}\s*[\.、\)]\s*[\[【]?(?:单选题|多选题|判断题|填空题)[\]】]?\s*\(\d+分\)/g) || [];
  if (repeatedHeaders.length > 1) score -= 140;

  if (typeGuess === "single_choice" || typeGuess === "multi_choice") {
    const uniqueOptions = new Set(Array.from(normalized.matchAll(/([A-D])[\.\):：、]/g)).map((m) => m[1]));
    score += uniqueOptions.size * 25;
  }

  return score;
}

function normalizePreviewText(text: string): string {
  return normalizeMathDisplayText(String(text || "").replace(/\s+/g, " ").trim());
}
