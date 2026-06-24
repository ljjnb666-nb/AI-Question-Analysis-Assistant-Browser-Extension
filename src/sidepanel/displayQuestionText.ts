import type { HistoryEntry, QuestionBlock, QuestionDisplaySegment, QuestionType } from "@/shared/types";

type HistoryItem = HistoryEntry;
export type UILang = "zh" | "en";

const JUDGE_HEADER_RE = /\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)/g;

export function normalizeText(s: string): string {
  return normalizeMathDisplayText(String(s || "").replace(/\s+/g, " ").trim());
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

export function cleanCandidatePreviewText(s: string): string {
  const normalized = normalizeText(s);
  if (!normalized) return "";

  const noiseMarkers = [
    "返回",
    "作业详情",
    "提交作业",
    "上一题",
    "下一题",
    "标记此题",
    "课堂练习",
    "总分",
    "题库卡",
    "答题卡",
    "提示我知道了",
    "提示提交",
    "重做",
    "取消",
    "退出",
    "文件预览",
    "在线客服",
  ];

  let cutIndex = -1;
  for (const marker of noiseMarkers) {
    const index = normalized.indexOf(marker);
    if (index > 0 && (cutIndex < 0 || index < cutIndex)) {
      cutIndex = index;
    }
  }

  const cleaned = cutIndex > 0 ? normalized.slice(0, cutIndex) : normalized;
  return normalizeText(cleaned);
}

export function formatQuestionTextForDisplay(s: string): string {
  const base = String(s || "").replace(/\r\n?/g, "\n").trim();
  if (!base) return "";
  return base
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(^|[\n。；;!?！？]\s*|\s{2,})(\(\d+\)|（\d+）)(?!\s*\/)/g, (_m, prefix, marker) => `${prefix}\n${marker}`)
    .replace(/\s*([①②③④⑤⑥⑦⑧⑨⑩])/g, "\n$1")
    .replace(/\s*(?=[A-D][\.\):：、]\s)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildCandidateStemForDisplay(
  block: QuestionBlock,
  stemText: string,
  rawPreviewText: string,
  lang: UILang,
): string {
  const normalizedStem = cleanCandidatePreviewText(stemText);
  const imageLike = Boolean(block.questionImageUrl) || /\[图片\]|图片/.test(rawPreviewText);
  if (!imageLike) {
    return normalizedStem;
  }

  const compact = compactImageHeavyStem(rawPreviewText, normalizedStem);
  if (compact) {
    return `${compact} ${lang === "en" ? "(Image question)" : "（配图题）"}`.trim();
  }

  return `${normalizedStem.replace(/\[图片\]/g, "").trim()} ${lang === "en" ? "(Image question)" : "（配图题）"}`.trim();
}

export function buildDisplaySegmentsForCandidate(
  block: QuestionBlock,
  stemText: string,
  rawPreviewText: string,
  lang: UILang,
): QuestionDisplaySegment[] {
  if (block.questionTypeGuess === "judge" || block.questionTypeGuess === "fill_blank") return [];

  if (block.displaySegments?.length) {
    return block.displaySegments
      .map((segment) => {
        if (segment.type === "image") return segment;
        return { ...segment, text: segment.text.replace(/\[图片\]/g, "").trim() };
      })
      .filter((segment) => segment.type === "image" || segment.text);
  }

  const imageUrl = getDisplayQuestionImageFromBlock(block);
  if (!imageUrl) return [];

  const displayStem = buildCandidateStemForDisplay(block, stemText, rawPreviewText, lang)
    .replace(/\s*[（(]配图题[)）]\s*$/g, "")
    .trim();
  const [lead, ...tailParts] = displayStem.split(/\[图片\]/g);
  const tail = tailParts.join(" ").trim();
  const segments: QuestionDisplaySegment[] = [];
  if (lead.trim()) segments.push({ type: "text", text: lead.trim() });
  segments.push({ type: "image", url: imageUrl });
  if (tail) segments.push({ type: "text", text: tail });
  return segments;
}

function compactImageHeavyStem(rawPreviewText: string, fallbackStem: string): string {
  const raw = cleanCandidatePreviewText(rawPreviewText || "");
  const headerMatch = raw.match(/^\d{1,3}\s*[\.、]\s*(?:单选题|多选题|判断题|填空题)?\s*(?:（\d+分）|\(\d+分\))?/);
  const header = normalizeText(headerMatch?.[0] || "");
  const withoutHeader = raw.replace(headerMatch?.[0] || "", "").trim();

  const imageParts = withoutHeader.split("[图片]");
  const beforeImage = normalizeText((imageParts[0] || "").trim());
  const afterImage = normalizeText(imageParts.slice(1).join(" ").trim());

  let lead = stripFormulaNoiseForImageStem(beforeImage);
  let tail = sanitizeImageStemTail(afterImage);

  if (!/[\u4e00-\u9fa5]{4,}/.test(lead)) {
    lead = stripFormulaNoiseForImageStem(
      normalizeText(fallbackStem)
        .replace(/\[图片\]/g, " ")
        .trim(),
    );
  }

  if (lead.length > 80) {
    lead = lead.slice(0, 80).replace(/\s+\S*$/, "").trim();
  }

  if ((!tail || tail.length < 6) && /[\u4e00-\u9fa5]{6,}/.test(fallbackStem)) {
    const fallbackTail = sanitizeImageStemTail(
      normalizeText(fallbackStem)
        .replace(beforeImage, "")
        .replace(/\[图片\]/g, " ")
        .trim(),
    );
    if (fallbackTail.length > tail.length) tail = fallbackTail;
  }

  const fallbackLead = stripFormulaNoiseForImageStem(
    beforeImage
      .replace(/\[图片\]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    { keepMathPlaceholders: true },
  );
  const mergedBody = [lead || fallbackLead, tail]
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const merged = normalizeText(`${header} ${mergedBody}`.trim());
  return trimDisplayStemTailNoise(merged);
}

function sanitizeImageStemTail(text: string): string {
  const normalized = normalizeText(text || "");
  if (!normalized) return "";

  return trimDisplayStemTailNoise(
    normalized
      .replace(/\.w\d+[a-z0-9]*\s+\.brush\d+\s*\{[^}]*\}/gi, " ")
      .replace(/\.w\d+[a-z0-9]*\s+\.pen\d+\s*\{[^}]*\}/gi, " ")
      .replace(/\b(?:q|TXXXX|\^+|=+\++|\(\d+\d+\d+\)|[xX]\s+[xX]\s+[xX])\b/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function stripFormulaNoiseForImageStem(
  text: string,
  options?: { keepMathPlaceholders?: boolean },
): string {
  const normalized = normalizeText(text || "");
  if (!normalized) return "";

  let out = normalized
    .replace(/\.w\d+[a-z0-9]*\s+\.brush\d+\s*\{[^}]*\}/gi, " ")
    .replace(/\.w\d+[a-z0-9]*\s+\.pen\d+\s*\{[^}]*\}/gi, " ")
    .replace(/[A-Za-z]{2,}\s*[:=]?\s*[0-9.()\-+*/]*/g, " ")
    .replace(/[0-9]+\s*(?:[,，]\s*[0-9]+){2,}/g, " ")
    .replace(/[θωσμλφψπτxyzXYZTLHGS]{1,}/g, " ");

  if (options?.keepMathPlaceholders) {
    out = out.replace(/\(\s*\)/g, "（ ）");
  } else {
    out = out.replace(/[=+\-*/()[\]{}<>]/g, " ");
  }

  return trimDisplayStemTailNoise(
    out
      .replace(/\s{2,}/g, " ")
      .replace(/\s*[:：]\s*/g, "：")
      .trim(),
  );
}

function trimDisplayStemTailNoise(text: string): string {
  const normalized = normalizeText(text || "");
  if (!normalized) return "";
  return normalized
    .replace(/\s*(?:\[图片\]|图片)\s*$/g, "")
    .replace(/\s*[=+\-*/(){}\[\]<>.,，;；:：]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function getDisplayQuestionImage(entry: HistoryItem): string {
  return getDisplayQuestionImageFromBlock(entry.block);
}

export function getDisplayQuestionImageFromBlock(block: QuestionBlock): string {
  const q = String(block.questionImageUrl || "").trim();
  if (!/^https?:\/\//i.test(q)) return "";
  if (!/\.(png|jpg|jpeg|webp)(?:[?#]|$)/i.test(q)) return "";
  if (!/(tikuimgs\.oss-|aliyuncs\.com|tiku\.cn|polymas\.com)/i.test(q)) return "";
  return q;
}

export function splitStemAndOptions(text: string): { stem: string; options: Array<{ key: string; value: string }> } {
  const normalized = cleanCandidatePreviewText(text);
  const firstOptionIdx = normalized.search(/[A-D][\.\):：、]/);
  if (firstOptionIdx < 0) return { stem: normalized, options: [] };

  const stem = normalizeText(normalized.slice(0, firstOptionIdx));
  const optionSegment = normalized.slice(firstOptionIdx);
  const rawMatches = Array.from(optionSegment.matchAll(/([A-D])[\.\):：、]\s*([\s\S]*?)(?=(?:\s+[A-D][\.\):：、])|$)/g));
  const dedup = new Map<string, string>();
  for (const m of rawMatches) {
    const key = m[1];
    const value = sanitizeOptionValue(m[2] || "");
    if (!value) continue;
    if (!dedup.has(key)) dedup.set(key, value);
  }
  const options = [...dedup.entries()].map(([key, value]) => ({ key, value }));
  if (!looksLikeCleanOptions(stem, options)) {
    return { stem: normalized, options: [] };
  }
  return { stem, options };
}

export function splitStemAndBlanks(text: string): { stem: string; blanks: Array<{ label: string; hint: string }> } {
  const normalized = cleanCandidatePreviewText(text).replace(/请输入答案/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return { stem: "", blanks: [] };

  const labelRegex = /(?:^|\s)(\d+\.\d+|[（(]\d+[)）])(?=\s|$)/g;
  const matches = Array.from(normalized.matchAll(labelRegex));
  const labels = matches.map((m) => m[1]);
  const uniqueLabels = Array.from(new Set(labels));
  const firstLabelIdx = matches[0]?.index ?? -1;
  const stemCandidate = firstLabelIdx > 0 ? normalized.slice(0, firstLabelIdx).trim() : normalized;

  if (uniqueLabels.length > 0) {
    return {
      stem: stemCandidate,
      blanks: uniqueLabels.map((label, idx) => ({
        label: normalizeBlankLabel(label, idx),
        hint: "",
      })),
    };
  }

  const underscoreCount = (normalized.match(/_{3,}|—{2,}|﹍{2,}/g) || []).length;
  if (underscoreCount > 0) {
    return {
      stem: normalized,
      blanks: Array.from({ length: underscoreCount }, (_, idx) => ({
        label: `空${idx + 1}`,
        hint: "",
      })),
    };
  }

  return { stem: normalized, blanks: [] };
}

export function splitJudgeStemAndOptions(text: string): { stem: string; options: Array<{ key: string; value: string }> } {
  const normalized = cleanCandidatePreviewText(text);
  if (!normalized) return { stem: "", options: [] };

  const stem = extractJudgeDisplayStem(normalized);
  const options: Array<{ key: string; value: string }> = [];
  const hasStandaloneJudgeWords = /(?:^|\s)(?:对|错|正确|错误)(?=\s|$)/.test(normalized);

  if (/\btrue\b|\bfalse\b/i.test(normalized)) {
    options.push({ key: "T", value: "True" });
    options.push({ key: "F", value: "False" });
    return { stem, options };
  }

  if (/(?:^|\s)(?:正确|错误)(?=\s|$)/.test(normalized)) {
    options.push({ key: "对", value: "" });
    options.push({ key: "错", value: "" });
    return { stem, options };
  }

  if (hasStandaloneJudgeWords) {
    options.push({ key: "对", value: "" });
    options.push({ key: "错", value: "" });
  }

  return { stem, options };
}

function extractJudgeDisplayStem(text: string): string {
  const normalized = cleanCandidatePreviewText(text);
  if (!normalized) return "";

  const headers = Array.from(normalized.matchAll(JUDGE_HEADER_RE));
  let out = normalized;
  const firstIndex = headers[0]?.index ?? -1;
  if (firstIndex > 0) out = out.slice(firstIndex).trim();
  if (headers.length >= 2 && typeof headers[1].index === "number") {
    out = out.slice(0, headers[1].index).trim();
  }

  const explicitSentence = out.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*.*?[。！？!?])/);
  if (explicitSentence?.[1]) return dedupeRepeatedJudgeStemForDisplay(explicitSentence[1]);

  const cutAtOption = out.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*.*?)(?=\s+(?:对|错|正确|错误|true|false)\b)/i);
  if (cutAtOption?.[1]) return dedupeRepeatedJudgeStemForDisplay(cutAtOption[1]);

  return dedupeRepeatedJudgeStemForDisplay(out);
}

function dedupeRepeatedJudgeStemForDisplay(text: string): string {
  const normalized = cleanCandidatePreviewText(text);
  if (!normalized) return "";

  const headerMatch = normalized.match(/^(\d{1,3}\s*[\.、\)]\s*[\[【]?判断题[\]】]?\s*\(\d+分\)\s*)(.+)$/);
  if (!headerMatch) return normalizeText(normalized);

  const header = headerMatch[1];
  const body = headerMatch[2].trim();
  if (!body) return normalizeText(normalized);

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

export function ensureBlankPlaceholders(text: string, blankCount: number): string {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized || blankCount <= 0) return normalized;

  const existingBlankCount = (normalized.match(/_{3,}|—{2,}|﹍{2,}/g) || []).length;
  if (existingBlankCount >= blankCount) return normalized;

  let remaining = blankCount - existingBlankCount;
  let rebuilt = normalized.replace(
    /([\u4e00-\u9fa5A-Za-z0-9])\s+(?=[\u4e00-\u9fa5A-Za-z0-9])/g,
    (full, prev) => {
      if (remaining <= 0) return full;
      remaining -= 1;
      return `${prev} ____ `;
    },
  );

  if (remaining > 0) {
    const suffix = Array.from({ length: remaining }, () => " ____ ").join("");
    rebuilt = `${rebuilt}${suffix}`;
  }

  return rebuilt.replace(/\s{2,}/g, " ").trim();
}

function normalizeBlankLabel(label: string, idx: number): string {
  const trimmed = normalizeText(label).replace(/[()（）]/g, "");
  if (/^\d+\.\d+$/.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `空${trimmed}`;
  return trimmed || `空${idx + 1}`;
}

export function inferPreviewQuestionType(
  previewText: string,
  choiceOptionCount: number,
  blankCount: number,
  judgeOptionCount: number,
): QuestionType {
  const text = cleanCandidatePreviewText(previewText);
  if (!text) return "unknown";
  if (/判断题|是非题/.test(text) || judgeOptionCount >= 2) return "judge";
  if (/填空题|____|________/.test(text) || blankCount > 0) return "fill_blank";
  if (/多选/.test(text)) return "multi_choice";
  if (/单选/.test(text)) return "single_choice";
  if (choiceOptionCount >= 4) return "single_choice";
  return "unknown";
}

function sanitizeOptionValue(raw: string): string {
  const normalized = cleanCandidatePreviewText(raw);
  if (!normalized) return "";

  const repeatedHeaderMatch = normalized.match(/\s+\d{1,3}\s*[\.、．]\s*[\[【]?(?:单选题|多选题|判断题|填空题)[\]】]?\s*\(\d+分\)/u);
  const preTrimmed = repeatedHeaderMatch?.index && repeatedHeaderMatch.index > 0
    ? normalizeText(normalized.slice(0, repeatedHeaderMatch.index))
    : normalized;

  const noisePattern = /(?:返回|作业详情|提交作业|上一题|下一题|标记此题|课堂练习|总分|题库卡|答题卡|单选题|多选题|判断题|填空题|提示我知道了|提示提交|重做|取消|退出|文件预览|在线客服|submit|previous|next)/i;
  const match = noisePattern.exec(preTrimmed);
  let trimmed = (!match || match.index <= 0)
    ? preTrimmed
    : normalizeText(preTrimmed.slice(0, match.index));

  trimmed = trimTrailingNextQuestionMarker(trimmed);
  return stripTrailingSectionNoise(trimmed);
}

function trimTrailingNextQuestionMarker(text: string): string {
  let out = normalizeText(text);
  if (!out) return "";

  out = out
    .replace(/\s+[一二三四五六七八九十]+、\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【](?:单选题|多选题|判断题|填空题)?[\]】]?\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*[\[【]\s*$/u, "")
    .replace(/\s+\d{1,3}\s*[\.、．]\s*$/u, "")
    .trim();

  return out;
}

function stripTrailingSectionNoise(text: string): string {
  let out = normalizeText(text);
  if (!out) return "";

  out = out
    .replace(/\s+[一二三四五六七八九十]+、\s*$/u, "")
    .replace(/\s+第\s*[一二三四五六七八九十\d]+\s*[章节题]\s*$/u, "")
    .replace(/\s+\d+\s*[、.．]\s*$/u, "")
    .trim();

  return out;
}

function looksLikeCleanOptions(stem: string, options: Array<{ key: string; value: string }>): boolean {
  if (options.length < 2) return false;

  const keys = options.map((option) => option.key).join("");
  if (!/^A(B(C(D)?)?)?$/.test(keys)) return false;

  const values = options.map((option) => option.value);
  if (values.some((value) => !value || value.length > 120)) return false;
  if (values.some((value) => /返回|提交作业|上一题|下一题|课堂练习|文件预览|在线客服/i.test(value))) return false;

  const stemLength = normalizeText(stem).length;
  const totalOptionLength = values.reduce((sum, value) => sum + value.length, 0);
  if (stemLength > 0 && totalOptionLength > stemLength * 3.2) return false;

  return true;
}
