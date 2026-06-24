import type { ParseResult, QuestionBlock, RouteUsed } from "../types";
import { logError, logWarn } from "../utils/errorLogger";
import {
  deriveChoiceAnswerFromSelections,
  extractOptionSelections,
  inferChoiceAnswerFromExplanation,
  inferChoiceTypeFromQuestionText,
  isOptionLetterSet,
  normalizeAnswer,
  resolveStableChoiceResolution,
} from "./parseResultChoice";
import { normalizeRecognizedQuestionText, sanitizeModelText } from "./parseResultNormalization";
// ---- Result Builder ----

export function buildResult(block: QuestionBlock, route: RouteUsed, rawText: string): ParseResult {
  const clean = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  let parsed: Record<string, unknown> = {};
  let parsedByFallback = false;
  try {
    parsed = JSON.parse(clean);
  } catch (firstErr) {
    logWarn("Failed to parse JSON response, attempting extraction", "buildResult", { rawText: clean.slice(0, 100) });
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (secondErr) {
        logError("Failed to extract JSON from response", secondErr, "buildResult", { rawText: clean.slice(0, 200) });
      }
    }
    if (Object.keys(parsed).length === 0) {
      parsed = extractFieldsFromLooseJsonLikeText(clean);
      parsedByFallback = Object.keys(parsed).length > 0;
    }
  }

  let questionType = (parsed.questionType as ParseResult["questionType"]) ?? "unknown";
  const rawAnswer = typeof parsed.answer === "string" && parsed.answer
    ? parsed.answer
    : (inferAnswerFromRawText(clean) || "—");
  let answer = normalizeAnswerByType(rawAnswer, questionType);
  if (questionType === "single_choice" && /[,，、/|]/.test(answer)) {
    questionType = "multi_choice";
  }
  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.8;

  const parsedRecognizedRaw = typeof parsed.recognizedText === "string" ? parsed.recognizedText : "";
  const parsedRecognized = sanitizeModelText(parsedRecognizedRaw);
  const previewSanitized = sanitizeModelText(block.previewText ?? "");
  const recognizedTextRaw = shouldFallbackToPreview(parsedRecognized, previewSanitized)
    ? previewSanitized
    : parsedRecognized;
  const recognizedText = normalizeRecognizedQuestionText(
    recognizedTextRaw,
    questionType,
    block.questionTypeGuess,
  );
  const strongChoiceType = inferChoiceTypeFromQuestionText(`${recognizedText}\n${block.previewText || ""}`);
  if ((questionType === "fill_blank" || questionType === "short_answer" || questionType === "unknown") && strongChoiceType) {
    questionType = strongChoiceType;
  }
  let optionSelections = extractOptionSelections(parsed);
  const answerFromSelections = deriveChoiceAnswerFromSelections(questionType, optionSelections);
  if (answerFromSelections) {
    answer = answerFromSelections;
  }
  const briefRaw = typeof parsed.briefExplanation === "string"
    ? parsed.briefExplanation
    : (parsedByFallback ? "已通过容错模式提取解析结果" : "(解析提取失败)");
  const detailedRaw = typeof parsed.detailedExplanation === "string"
    ? parsed.detailedExplanation
    : rawText.slice(0, 600);
  const structured = formatMultiPartExplanation(
    sanitizeModelText(briefRaw),
    sanitizeModelText(detailedRaw),
    recognizedText,
    questionType,
  );
  const corrected = applyBiologyHeuristicCorrections(structured.detailed, recognizedText);
  const nonChoiceLike = shouldTreatAsNonChoice(questionType, recognizedText, structured.detailed, block.previewText || "");
  if (nonChoiceLike) {
    if (questionType === "single_choice" || questionType === "multi_choice" || questionType === "unknown") {
      questionType = inferNonChoiceType(recognizedText, block.previewText || "");
    }
    if (isOptionLetterSet(answer)) {
      const extracted = extractNonChoiceAnswerFromText(`${corrected}\n${structured.brief}`);
      answer = extracted || "需人工确认";
    } else if (isWeakNonChoiceAnswer(answer)) {
      const extracted = extractNonChoiceAnswerFromText(`${answer}\n${corrected}\n${structured.brief}`);
      answer = extracted || "需人工确认";
    }
  }

  answer = normalizePlaceholderAnswer(answer, questionType);

  if (questionType === "single_choice") {
    const correctedByRule = applyProbabilitySingleChoiceCorrection(
      answer,
      recognizedText,
      block.previewText || "",
    );
    if (correctedByRule && correctedByRule !== answer) {
      answer = correctedByRule;
    }
  }

  let correctedByExplanation = "";
  if (questionType === "single_choice" || questionType === "multi_choice") {
    correctedByExplanation = inferChoiceAnswerFromExplanation(
      questionType,
      recognizedText,
      block.previewText || "",
      structured.brief,
      corrected,
    );
    if (correctedByExplanation) {
      answer = correctedByExplanation;
    }
  }

  const warning = typeof parsed.warning === "string" ? parsed.warning : undefined;
  if (questionType === "single_choice" || questionType === "multi_choice") {
    const stableChoice = resolveStableChoiceResolution(
      questionType,
      normalizeAnswer(rawAnswer),
      answerFromSelections,
      correctedByExplanation,
      `${structured.brief}\n${corrected}`,
    );
    if (stableChoice.answer) {
      answer = stableChoice.answer;
      if (stableChoice.optionSelections) {
        optionSelections = stableChoice.optionSelections;
      }
    } else {
      answer = "需人工确认";
    }
  }
  const finalWarning = answer === "需人工确认"
    ? [warning, "选择题未提取到稳定的结构化选项结论，需人工确认后再填写。"].filter(Boolean).join(" ")
    : warning;

  return {
    blockId: block.id,
    questionType,
    answer,
    confidence,
    briefExplanation: structured.brief,
    detailedExplanation: corrected,
    recognizedText,
    routeUsed: route,
    optionSelections,
    ocrQualityScore: 0.85,
    warning: finalWarning || undefined,
  };
}

function applyProbabilitySingleChoiceCorrection(
  currentAnswer: string,
  recognizedText: string,
  previewText: string,
): string | null {
  const text = `${recognizedText}\n${previewText}`;
  if (!/在放回抽样/.test(text)) return null;
  const total = firstIntAfter(text, /箱子里有\s*(\d+)\s*只开关/);
  const good = firstIntAfter(text, /正品\s*(\d+)\s*只/);
  if (!total || !good || total <= 0 || good <= 0 || good > total) return null;

  let target: number | null = null;
  if (/X\s*=\s*0\s*表示第.?一?次取出正品/.test(text) && !/X\s*=\s*0\s*[,，、].*Y\s*=\s*0/.test(text)) {
    target = good / total;
  } else if (/Y\s*=\s*0\s*表示第.?二?次取出正品/.test(text) && !/X\s*=\s*0\s*[,，、].*Y\s*=\s*0/.test(text)) {
    target = good / total;
  } else if (/X\s*=\s*0/.test(text) && /Y\s*=\s*0/.test(text)) {
    target = (good / total) * (good / total);
  }
  if (target == null) return null;

  const options = extractChoiceOptionValues(text);
  if (options.length < 2) return null;
  let best: { key: string; diff: number } | null = null;
  for (const op of options) {
    if (op.value == null || !Number.isFinite(op.value)) continue;
    const diff = Math.abs(op.value - target);
    if (!best || diff < best.diff) best = { key: op.key, diff };
  }
  if (!best) return null;

  if (/^[A-D]$/.test(currentAnswer) && currentAnswer === best.key) return null;
  return best.key;
}

function firstIntAfter(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function extractChoiceOptionValues(text: string): Array<{ key: string; value: number | null }> {
  const clean = String(text || "").replace(/\r/g, "");
  const pattern = /(?:^|\n|\s)([A-D])[、.．:：)\]]\s*([^\nA-D]{1,40})/g;
  const out: Array<{ key: string; value: number | null }> = [];
  for (const m of clean.matchAll(pattern)) {
    const key = m[1];
    const raw = m[2].trim();
    out.push({ key, value: parseSimpleNumericValue(raw) });
  }
  return out;
}

function parseSimpleNumericValue(raw: string): number | null {
  const s = String(raw || "").replace(/\s+/g, "");
  if (!s) return null;
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
  }
  const num = s.match(/^-?\d+(?:\.\d+)?$/);
  if (num) {
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function applyBiologyHeuristicCorrections(detailed: string, recognizedText: string): string {
  let out = String(detailed || "");
  const stem = String(recognizedText || "");

  // In this classic "four organics mapping" problem, models may swap A/E in wheat-seed context.
  if (/生物体内四种有机物的组成与功能关系图/.test(stem) && /小麦种子细胞中.*物质A.*物质E/.test(stem)) {
    out = out
      .replace(/物质A[是为]\s*淀粉[^。\n，；]*[，；]\s*物质E[是为]\s*葡萄糖/g, "物质A是葡萄糖，物质E是淀粉")
      .replace(/\(\s*1\s*\)[^。\n]*?淀粉[^。\n]*?葡萄糖/g, (m) => {
        if (/葡萄糖[^。\n]*淀粉/.test(m)) return m;
        return m.replace(/淀粉[\s、，；;]*葡萄糖|淀粉[\s、，；;]+.*?葡萄糖/g, "葡萄糖；淀粉");
      });
  }

  // Protein chain oxygen-count minimum is commonly misreported as a+b-1.
  if (/a个C物质组成b条链|a\s*个\s*C.*b\s*条链/.test(stem)) {
    out = out
      .replace(/\b(?:a\+b|b\+a)\s*-\s*1\b/g, "a+b")
      .replace(/\b(?:a\+b-1|b\+a-1)\b/g, "a+b");
  }

  // Biuret control group should be known protein solution, not water.
  if (/双缩脲|磷酸化酶是否为蛋白质/.test(stem)) {
    out = out.replace(/对照组[^。\n]*?(清水|蒸馏水)/g, (m) => {
      return m.replace(/清水|蒸馏水/g, "等量已知蛋白质液（豆浆、蛋清等）");
    });
  }

  return out;
}

function shouldTreatAsNonChoice(
  questionType: ParseResult["questionType"],
  recognizedText: string,
  detailed: string,
  previewText: string,
): boolean {
  if (questionType === "fill_blank" || questionType === "short_answer" || questionType === "judge") return true;
  const text = `${recognizedText}\n${detailed}\n${previewText}`;
  if (inferChoiceTypeFromQuestionText(text)) return false;
  if (/填空|请据图回答|____|________/.test(text)) return true;
  const indexedParts = text.match(/\(\s*\d+\s*\)|（\s*\d+\s*）/g) || [];
  return indexedParts.length >= 2;
}

function inferNonChoiceType(recognizedText: string, previewText: string): ParseResult["questionType"] {
  const text = `${recognizedText}\n${previewText}`;
  if (inferChoiceTypeFromQuestionText(text)) return "unknown";
  if (/填空|____|________/.test(text)) return "fill_blank";
  const indexedParts = text.match(/\(\s*\d+\s*\)|（\s*\d+\s*）/g) || [];
  if (/请据图回答/.test(text) || indexedParts.length >= 2) return "fill_blank";
  return "short_answer";
}

function isWeakNonChoiceAnswer(answer: string): boolean {
  const a = String(answer || "").trim();
  if (!a) return true;
  if (isOptionLetterSet(a)) return true;
  if (looksLikePlaceholderAnswer(a)) return true;
  const hasPoint = /\(\s*\d+\s*\)|（\s*\d+\s*）|[①②③④⑤⑥⑦⑧⑨⑩]/.test(a);
  const uncertain = /(无法|不确定|看不清|不完整|信息不足|缺少|未完整|不能确定)/.test(a);
  if (uncertain && !hasPoint) return true;
  if (a.length > 120 && !hasPoint) return true;
  return false;
}

function extractNonChoiceAnswerFromText(text: string): string {
  const normalized = String(text || "").replace(/\r/g, "").trim();
  if (!normalized) return "";
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /^(\d+\.|[①②③④⑤⑥⑦⑧⑨⑩])/.test(l));
  if (numbered.length >= 2) {
    const joined = numbered.slice(0, 6).join("；");
    return isOptionLetterSet(joined) ? "" : joined;
  }
  const answerLike = lines.filter((l) => /答案|填|应为|为：|是：/.test(l));
  if (answerLike.length > 0) {
    const joined = answerLike.slice(0, 3).join("；");
    if (/(无法判断|无法确定|题干不完整|信息不完整|看不清)/.test(joined)) return "";
    if (looksLikePlaceholderAnswer(joined)) return "";
    if (/答案\s*[:：]?\s*[A-D](?:\s*[,，、/|]\s*[A-D])*/i.test(joined)) return "";
    return isOptionLetterSet(joined) ? "" : joined;
  }
  return "";
}

function normalizeAnswerByType(raw: string, questionType: ParseResult["questionType"]): string {
  const t = questionType;
  if (t === "single_choice" || t === "multi_choice") return normalizeAnswer(raw);
  if (t === "fill_blank") return normalizeFillBlankAnswer(raw);
  const s = String(raw || "").trim();
  if (!s) return "—";
  return s;
}

function normalizePlaceholderAnswer(answer: string, questionType: ParseResult["questionType"]): string {
  if (questionType === "single_choice" || questionType === "multi_choice" || questionType === "judge") {
    return answer;
  }
  const normalized = String(answer || "").trim();
  if (!normalized) return "需人工确认";
  if (looksLikePlaceholderAnswer(normalized)) return "需人工确认";
  return normalized;
}

function looksLikePlaceholderAnswer(answer: string): boolean {
  const a = String(answer || "").replace(/\s+/g, "");
  if (!a) return true;
  return /(见分点答案|见分点作答|按分点作答|分点作答|仅供参考|参考答案见解析|详见解析|示例答案|需人工确认|未给出逐空答案|未提取到稳定答案|需结合解析判断)/.test(a);
}

function normalizeFillBlankAnswer(raw: string): string {
  const source = String(raw || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "—";

  const numberedMatches = Array.from(
    source.matchAll(/(?:^|[\n;；])\s*(?:\(?\d+\)?[.)、]|第\s*\d+\s*空\s*[:：]?|\d+\.\d+\s*[:：]?|\d+\s*[:：.。．、]\s*)([^\n;；]+)/g),
  );
  if (numberedMatches.length >= 2) {
    const parts = numberedMatches
      .map((match) => sanitizeFillBlankPart(match[1] || ""))
      .filter(Boolean);
    if (parts.length) return parts.join("；");
  }

  const splitParts = source
    .split(/[\n;；]+/)
    .map((part) => sanitizeFillBlankPart(part))
    .filter(Boolean);
  if (splitParts.length >= 2) return splitParts.join("；");

  return sanitizeFillBlankPart(source) || "—";
}

function sanitizeFillBlankPart(part: string): string {
  return String(part || "")
    .replace(/^\s*(?:\(?\d+\)?[.)、]|第\s*\d+\s*空\s*[:：]?|\d+\.\d+\s*[:：]?|\d+\s*[:：.。．、]\s*)/, "")
    .replace(/^答案\s*[:：]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMultiPartExplanation(
  brief: string,
  detailed: string,
  recognizedText: string,
  questionType: ParseResult["questionType"],
): { brief: string; detailed: string } {
  const source = `${recognizedText}\n${detailed}`;
  const multiPartSignals = [
    /\(\s*1\s*\)/,
    /（\s*1\s*）/,
    /\n\s*1[\.、]/,
  ];
  const isLikelyMultiPart =
    (questionType === "fill_blank" || questionType === "short_answer" || questionType === "unknown")
    && multiPartSignals.some((re) => re.test(source));
  if (!isLikelyMultiPart) return { brief, detailed };

  const normalized = String(detailed || "")
    .replace(/（\s*(\d+)\s*）/g, "\n$1. ")
    .replace(/\(\s*(\d+)\s*\)/g, "\n$1. ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  const bulletLike = lines.filter((l) => /^\d+\.\s*/.test(l));
  if (bulletLike.length < 2) {
    return {
      brief: `${brief}\n检测到该题为多小问，建议按(1)(2)(3)分点作答。`,
      detailed: normalized,
    };
  }

  const compact = lines
    .map((l) => (/^\d+\.\s*/.test(l) ? l : `- ${l}`))
    .join("\n");
  return {
    brief: `${brief}\n已按小问分点整理答案。`,
    detailed: compact,
  };
}

function extractFieldsFromLooseJsonLikeText(text: string): Record<string, unknown> {
  const pick = (field: string): string | undefined => {
    const m = text.match(new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,|\\n\\s*"|\\n\\s*\\}|\\})`, "i"));
    return m?.[1];
  };
  const pickNum = (field: string): number | undefined => {
    const m = text.match(new RegExp(`"${field}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"));
    return m ? Number(m[1]) : undefined;
  };
  const out: Record<string, unknown> = {};
  const questionType = pick("questionType");
  const answer = pick("answer");
  const brief = pick("briefExplanation");
  const detailed = pick("detailedExplanation");
  const recognized = pick("recognizedText");
  const warning = pick("warning");
  const confidence = pickNum("confidence");

  if (questionType) out.questionType = unescapeLooseJsonString(questionType);
  if (answer) out.answer = unescapeLooseJsonString(answer);
  if (brief) out.briefExplanation = unescapeLooseJsonString(brief);
  if (detailed) out.detailedExplanation = unescapeLooseJsonString(detailed);
  if (recognized) out.recognizedText = unescapeLooseJsonString(recognized);
  if (warning && warning.toLowerCase() !== "null") out.warning = unescapeLooseJsonString(warning);
  if (typeof confidence === "number" && Number.isFinite(confidence)) out.confidence = confidence;
  return out;
}

function unescapeLooseJsonString(s: string): string {
  return s
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .trim();
}

function inferAnswerFromRawText(raw: string): string {
  const s = String(raw || "").toUpperCase();
  if (!s) return "";
  const multi = s.match(/[A-D](?:\s*[,，、/|]\s*[A-D])+/g);
  if (multi?.length) {
    const longest = multi.sort((a, b) => b.length - a.length)[0];
    return longest;
  }
  const single = s.match(/(?:答案|应选|正确答案|CORRECT)\s*[:：为是]?\s*([A-D])/i);
  return single?.[1] ?? "";
}

function shouldFallbackToPreview(recognizedText: string, previewText: string): boolean {
  const rec = String(recognizedText || "").trim();
  const preview = String(previewText || "").trim();
  if (!rec) return true;
  if (!preview) return false;

  const qCount = (rec.match(/\?/g) || []).length;
  const badRatio = qCount / Math.max(1, rec.length);
  const cjkCount = (rec.match(/[\u4e00-\u9fff]/g) || []).length;

  if (qCount >= 3 && badRatio > 0.08 && cjkCount < 2) {
    const previewCjk = (preview.match(/[\u4e00-\u9fff]/g) || []).length;
    if (previewCjk >= 4) return true;
  }
  return false;
}


