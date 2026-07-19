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
import { buildPreferredQuestionText } from "./questionPromptText";
// ---- Result Builder ----

export function buildResult(block: QuestionBlock, route: RouteUsed, rawText: string): ParseResult {
  const clean = sanitizeRawModelResponse(rawText);
  let parsed: Record<string, unknown> = {};
  let parsedByFallback = false;
  try {
    parsed = JSON.parse(clean);
  } catch (_firstErr) {
    logWarn("Failed to parse JSON response, attempting extraction", "buildResult", { rawText: clean.slice(0, 100) });
    const extractedJson = extractLikelyJsonPayload(clean);
    if (extractedJson) {
      try {
        parsed = JSON.parse(extractedJson);
      } catch (secondErr) {
        logError("Failed to extract JSON from response", secondErr, "buildResult", { rawText: clean.slice(0, 200) });
      }
    }
    if (Object.keys(parsed).length === 0) {
      parsed = extractFieldsFromLooseJsonLikeText(extractedJson || clean);
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
  const sourceQuestionText = buildPreferredQuestionText(block);
  const previewSanitized = sanitizeModelText(sourceQuestionText);
  const recognizedTextRaw = shouldFallbackToPreview(parsedRecognized, previewSanitized)
    ? previewSanitized
    : parsedRecognized;
  const recognizedText = normalizeRecognizedQuestionText(
    recognizedTextRaw,
    questionType,
    block.questionTypeGuess,
  );
  const codeProblemLikely = isCodeProblemLikely(`${recognizedText}\n${sourceQuestionText}`);
  const judgeQuestionLikely = isJudgeQuestionLikely(`${recognizedText}\n${sourceQuestionText}`, block.questionTypeGuess);
  const strongChoiceType = inferChoiceTypeFromQuestionText(`${recognizedText}\n${sourceQuestionText}`);
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
  if (judgeQuestionLikely) {
    questionType = "judge";
    answer = normalizeJudgeAnswer(
      answer,
      `${structured.brief}\n${corrected}\n${recognizedText}\n${sourceQuestionText}`,
    ) || answer;
    optionSelections = undefined;
  }
  const nonChoiceLike = shouldTreatAsNonChoice(questionType, recognizedText, structured.detailed, sourceQuestionText);
  if (nonChoiceLike) {
    if (questionType === "single_choice" || questionType === "multi_choice" || questionType === "unknown") {
      questionType = inferNonChoiceType(recognizedText, sourceQuestionText);
    }
    if (isOptionLetterSet(answer)) {
      const extracted = extractNonChoiceAnswerFromText(`${corrected}\n${structured.brief}`);
      answer = extracted || "需人工确认";
    } else if (isWeakNonChoiceAnswer(answer)) {
      const extracted = extractNonChoiceAnswerFromText(`${answer}\n${corrected}\n${structured.brief}`);
      answer = extracted || "需人工确认";
    }
  }

  if (codeProblemLikely) {
    questionType = "short_answer";
    const extractedCodeAnswer = extractCodeAnswerFromSources([
      rawAnswer,
      typeof parsed.briefExplanation === "string" ? parsed.briefExplanation : "",
      typeof parsed.detailedExplanation === "string" ? parsed.detailedExplanation : "",
      clean,
    ]);
    if (extractedCodeAnswer) {
      answer = extractedCodeAnswer;
    } else {
      answer = "需人工确认";
    }
  }

  answer = normalizePlaceholderAnswer(answer, questionType);

  if (questionType === "single_choice") {
    const correctedByRule = applyProbabilitySingleChoiceCorrection(
      answer,
      recognizedText,
      sourceQuestionText,
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
      sourceQuestionText,
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
  const finalWarning = (questionType === "single_choice" || questionType === "multi_choice") && answer === "需人工确认"
    ? [warning, "选择题未提取到稳定的结构化选项结论，需人工确认后再填写。"].filter(Boolean).join(" ")
    : warning;
  const mergedWarning = codeProblemLikely && answer === "需人工确认"
    ? [finalWarning, "代码题未提取到可直接填写的代码答案，请查看详情或视觉重试。"].filter(Boolean).join(" ")
    : finalWarning;

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
    warning: mergedWarning || undefined,
  };
}

function sanitizeRawModelResponse(rawText: string): string {
  const clean = String(rawText || "").replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const thinkEnd = clean.lastIndexOf("</think>");
  if (thinkEnd >= 0) {
    const afterThink = clean.slice(thinkEnd + "</think>".length).trim();
    if (afterThink) return afterThink;
  }
  return clean;
}

function extractLikelyJsonPayload(text: string): string {
  const source = sanitizeRawModelResponse(text);
  const schemaStart = source.search(/\{\s*"questionType"\s*:/);
  if (schemaStart >= 0) {
    const tail = source.slice(schemaStart);
    const tailEnd = tail.lastIndexOf("}");
    if (tailEnd >= 0) return tail.slice(0, tailEnd + 1);
  }

  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return source.slice(firstBrace, lastBrace + 1);
  }
  return "";
}

function isCodeProblemLikely(text: string): boolean {
  const normalized = String(text || "");
  return /(函数接口定义|裁判测试程序样例|输入格式|输出格式|输入样例|输出样例|样例输入|样例输出|代码长度限制)/.test(normalized);
}

function extractCodeAnswerFromSources(sources: string[]): string {
  for (const source of sources) {
    const normalized = normalizeCodeSnippet(source);
    if (looksLikeUsefulCodeSnippet(normalized)) return normalized;
  }
  return "";
}

function normalizeCodeSnippet(source: string): string {
  let text = String(source || "").trim();
  if (!text) return "";

  const fence = text.match(/```(?:c|cpp|c\+\+)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();

  const codeStart = text.search(/(?:#include\s*<|(?:char|int|long|double|float|void)\s+\*?\s*[A-Za-z_]\w*\s*\([^)]*\)\s*\{|return\s+|if\s*\(|for\s*\(|while\s*\()/);
  if (codeStart > 0) {
    text = text.slice(codeStart).trim();
  }

  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*注[:：].*$/gm, "")
    .replace(/^\s*(?:答案|参考代码|代码如下)[:：]\s*/gm, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, "\"")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeUsefulCodeSnippet(text: string): boolean {
  if (!text) return false;
  if (/^(注[:：]|由于|本题要求|根据输入|若.*返回|模型|具体形参)/.test(text)) return false;
  if (looksLikeNarrativeCodeAnswer(text)) return false;
  if (/["']\s*}\s*$/.test(text)) return false;

  const hasFunctionWithBody = /(?:char|int|long|double|float|void)\s+\*?\s*[A-Za-z_]\w*\s*\([^)]*\)\s*\{[\s\S]*\}/.test(text);
  const hasControlFlowBody = /\b(?:if|for|while|switch)\s*\([^)]*\)\s*\{[\s\S]*\}/.test(text);
  const statementCount = (text.match(/;/g) || []).length;
  const hasMultipleStatements = statementCount >= 2 && /[\n{}]/.test(text);

  return hasFunctionWithBody || hasControlFlowBody || hasMultipleStatements;
}

function looksLikeNarrativeCodeAnswer(text: string): boolean {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (/(?:^|\n)\s*(?:1[.)、:]|2[.)、:]|3[.)、:]|一[、.]|二[、.]|三[、.])\s*(?:函数|实现|思路|要点|步骤|说明|参考实现|完整参考实现)/.test(normalized)) {
    return true;
  }
  if (/(函数功能|实现要点|参考实现|完整参考实现如\s*answer\s*所示|已按小问分点整理答案)/.test(normalized)) {
    return true;
  }
  return false;
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
  if (t === "judge") return normalizeJudgeAnswer(raw, raw) || String(raw || "").trim() || "—";
  const s = String(raw || "").trim();
  if (!s) return "—";
  return s;
}

function isJudgeQuestionLikely(text: string, hint: QuestionBlock["questionTypeGuess"]): boolean {
  if (hint === "judge") return true;
  const normalized = String(text || "");
  return /(判断题|是非题|判断对错|判断正误|对\s*错|正确\s*错误|\btrue\b|\bfalse\b)/i.test(normalized);
}

function normalizeJudgeAnswer(answer: string, sourceText: string): "对" | "错" | null {
  const direct = String(answer || "").trim().toLowerCase();
  if (/^(对|正确|true|t|yes|y)[。.!！?？]?$/i.test(direct)) return "对";
  if (/^(错|错误|false|f|no|n)[。.!！?？]?$/i.test(direct)) return "错";

  const source = `${answer || ""}\n${sourceText || ""}`;
  if (/(答案|判断为|该说法|因此|所以|结论).{0,8}(错误|错|false)/i.test(source)) return "错";
  if (/(答案|判断为|该说法|因此|所以|结论).{0,8}(正确|对|true)/i.test(source)) return "对";
  if (/(说法错误|表述错误|命题错误|此题错误)/.test(source)) return "错";
  if (/(说法正确|表述正确|命题正确|此题正确)/.test(source)) return "对";
  return null;
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
  const out: Record<string, unknown> = {};
  const questionType = pickLooseJsonStringField(text, "questionType");
  const answer = pickLooseJsonStringField(text, "answer");
  const brief = pickLooseJsonStringField(text, "briefExplanation");
  const detailed = pickLooseJsonStringField(text, "detailedExplanation");
  const recognized = pickLooseJsonStringField(text, "recognizedText");
  const warning = pickLooseJsonStringField(text, "warning");
  const confidence = pickLooseJsonNumberField(text, "confidence");

  if (questionType) out.questionType = unescapeLooseJsonString(questionType);
  if (answer) out.answer = unescapeLooseJsonString(answer);
  if (brief) out.briefExplanation = unescapeLooseJsonString(brief);
  if (detailed) out.detailedExplanation = unescapeLooseJsonString(detailed);
  if (recognized) out.recognizedText = unescapeLooseJsonString(recognized);
  if (warning && warning.toLowerCase() !== "null") out.warning = unescapeLooseJsonString(warning);
  if (typeof confidence === "number" && Number.isFinite(confidence)) out.confidence = confidence;
  return out;
}

function pickLooseJsonStringField(text: string, field: string): string | undefined {
  const fieldPattern = new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*`, "ig");
  for (let match = fieldPattern.exec(text); match; match = fieldPattern.exec(text)) {
    let cursor = match.index + match[0].length;
    cursor = skipWhitespace(text, cursor);
    if (text[cursor] !== "\"") continue;
    const parsed = readLooseQuotedJsonString(text, cursor + 1);
    if (parsed) return parsed.value;
  }
  return undefined;
}

function pickLooseJsonNumberField(text: string, field: string): number | undefined {
  const m = text.match(new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"));
  return m ? Number(m[1]) : undefined;
}

function readLooseQuotedJsonString(
  text: string,
  start: number,
): { value: string; end: number } | null {
  let value = "";
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      if (i + 1 < text.length) {
        value += ch + text[i + 1];
        i += 1;
        continue;
      }
      value += ch;
      continue;
    }
    if (ch === "\"") {
      if (classifyLooseStringQuoteEnd(text, i + 1) === "end") {
        return { value, end: i };
      }
      value += ch;
      continue;
    }
    value += ch;
  }
  return value ? { value, end: text.length - 1 } : null;
}

function classifyLooseStringQuoteEnd(text: string, afterQuote: number): "end" | "content" {
  let cursor = skipWhitespace(text, afterQuote);
  const next = text[cursor];
  if (next === "}") return "end";
  if (next !== ",") return "content";

  cursor = skipWhitespace(text, cursor + 1);
  if (text[cursor] !== "\"") return "content";

  let nameEnd = cursor + 1;
  while (nameEnd < text.length && /[A-Za-z]/.test(text[nameEnd])) nameEnd += 1;
  if (nameEnd === cursor + 1 || text[nameEnd] !== "\"") return "content";

  const colonPos = skipWhitespace(text, nameEnd + 1);
  return text[colonPos] === ":" ? "end" : "content";
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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


