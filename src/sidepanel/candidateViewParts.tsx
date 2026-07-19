import type { DetectedCandidate, QuestionDisplaySegment, QuestionType } from "@/shared/types";
import { formatQuestionTextForDisplay, isStructuredAnswerExtractionFailed, renderMathText, resolveResultAnswerForDisplay, type UILang } from "./displayUtils";

const STATUS_COLORS: Record<string, string> = {
  idle: "#94a3b8",
  loading: "#f59e0b",
  success: "#10b981",
  error: "#ef4444",
};

const STATUS_LABELS_EN: Record<string, string> = {
  idle: "Pending",
  loading: "Parsing...",
  success: "Done",
  error: "Failed",
};

const STATUS_LABELS_ZH: Record<string, string> = {
  idle: "待处理",
  loading: "解析中...",
  success: "完成",
  error: "失败",
};

const TYPE_LABELS_EN: Record<string, string> = {
  single_choice: "Single",
  multi_choice: "Multi",
  judge: "Judge",
  fill_blank: "Blank",
  short_answer: "Short",
  unknown: "Unknown",
};

const TYPE_LABELS_ZH: Record<string, string> = {
  single_choice: "单选",
  multi_choice: "多选",
  judge: "判断",
  fill_blank: "填空",
  short_answer: "简答",
  unknown: "未知",
};

export function getTypeLabel(questionType: QuestionType, lang: UILang, fallback = "?") {
  return (lang === "en" ? TYPE_LABELS_EN : TYPE_LABELS_ZH)[questionType] ?? fallback;
}

export const DisplaySegmentsView: React.FC<{ segments: QuestionDisplaySegment[]; lang: UILang }> = ({ segments, lang }) => {
  const normalizedSegments = expandStructuredSegmentsForRender(segments);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {normalizedSegments.map((segment, idx) => (
        segment.type === "image" ? (
          <img
            key={`${segment.type}-${idx}`}
            src={segment.url}
            alt={lang === "en" ? "Question figure" : "题目配图"}
            style={{
              width: "100%",
              maxHeight: 220,
              objectFit: "contain",
              borderRadius: 12,
              border: "1px solid rgba(255, 255, 255, 0.08)",
              backgroundColor: "rgba(6, 12, 22, 0.92)",
            }}
          />
        ) : segment.role === "title" ? (
          <div
            key={`${segment.type}-${idx}`}
            style={{ fontSize: 17, fontWeight: 800, color: "#f3f7fd", lineHeight: 1.35, letterSpacing: 0.2 }}
          >
            {renderMathText(formatQuestionTextForDisplay(segment.text))}
          </div>
        ) : segment.role === "meta" ? (
          <div
            key={`${segment.type}-${idx}`}
            style={{ fontSize: 11, color: "#9fb1c7", lineHeight: 1.5 }}
          >
            {renderMathText(formatQuestionTextForDisplay(segment.text))}
          </div>
        ) : segment.role === "section" ? (
          <div
            key={`${segment.type}-${idx}`}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            {segment.label && (
              <div style={{ marginBottom: 6, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: "#9ec5ff" }}>
                {segment.label}
              </div>
            )}
            {renderStructuredSectionBody(segment, lang)}
          </div>
        ) : (
          <div key={`${segment.type}-${idx}`}>{renderMathText(formatQuestionTextForDisplay(segment.text))}</div>
        )
      ))}
    </div>
  );
};

function renderStructuredSectionBody(
  segment: Extract<QuestionDisplaySegment, { type: "text" }>,
  lang: UILang,
): React.ReactNode {
  if (segment.label === "函数接口") {
    const { code, prose } = splitInterfaceSection(segment.text);
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            lineHeight: 1.7,
            color: "#e7edf5",
            fontFamily: "Consolas, 'SFMono-Regular', 'Liberation Mono', Menlo, monospace",
            background: "rgba(8, 12, 20, 0.42)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          {formatStructuredCode(code)}
        </pre>
        {prose ? (
          <div style={{ color: "#e7edf5", lineHeight: 1.7 }}>
            {renderMathText(formatQuestionTextForDisplay(prose))}
          </div>
        ) : null}
      </div>
    );
  }

  if (segment.label === "裁判样例") {
    const codeText = formatStructuredCode(segment.text);
    return (
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 12,
          lineHeight: 1.7,
          color: "#e7edf5",
          fontFamily: "Consolas, 'SFMono-Regular', 'Liberation Mono', Menlo, monospace",
          background: "rgba(8, 12, 20, 0.42)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10,
          padding: "10px 12px",
        }}
      >
        {codeText}
      </pre>
    );
  }

  if (segment.label === "输入样例" || segment.label === "输出样例") {
    return (
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 12,
          lineHeight: 1.7,
          color: "#e7edf5",
          fontFamily: "Consolas, 'SFMono-Regular', 'Liberation Mono', Menlo, monospace",
          background: "rgba(8, 12, 20, 0.28)",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 10,
          padding: "10px 12px",
        }}
      >
        {segment.text}
      </pre>
    );
  }

  if (segment.label === "限制") {
    const items = parseConstraintItems(segment.text);
    if (items.length > 0) {
      return (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "8px 10px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ color: "#9fb1c7", fontSize: 11, fontWeight: 700 }}>{item.label}</span>
              <span style={{ color: "#e7edf5", fontSize: 12, fontWeight: 700 }}>{item.value}</span>
            </div>
          ))}
        </div>
      );
    }
  }

  return (
    <div style={{ color: "#e7edf5", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
      {renderMathText(formatQuestionTextForDisplay(segment.text || (lang === "en" ? "(Empty)" : "（空）")))}
    </div>
  );
}

function expandStructuredSegmentsForRender(segments: QuestionDisplaySegment[]): QuestionDisplaySegment[] {
  if (segments.some((segment) => segment.type === "text" && (segment.role || segment.label))) {
    return segments;
  }
  const textSegments = segments.filter((segment): segment is Extract<QuestionDisplaySegment, { type: "text" }> => segment.type === "text");
  if (textSegments.length === 0) return segments;

  const combinedText = textSegments.map((segment) => segment.text).join("\n");
  if (!looksLikePtaCodeProblem(combinedText)) return segments;

  const out: QuestionDisplaySegment[] = [];
  const title = cleanStructuredText(textSegments[0]?.text || "");
  if (title) out.push({ type: "text", text: title, role: "title" });

  const source = cleanStructuredText(combinedText.replace(textSegments[0]?.text || "", " ").trim());
  const metaMatch = source.match(/作者\s+.+?\s+单位\s+.+?(?=\s+(?:本题要求|函数接口定义：|输入格式：|输出格式：|输入样例|输出样例|样例输入|样例输出|代码长度限制)|$)/);
  if (metaMatch) {
    out.push({ type: "text", text: cleanStructuredText(metaMatch[0]), role: "meta" });
  }

  const body = cleanStructuredText(
    source
      .replace(metaMatch?.[0] || "", " ")
      .replace(title, " ")
      .trim(),
  );
  const sections = splitStructuredSections(body);
  for (const section of sections) {
    out.push({ type: "text", text: section.text, role: "section", label: section.label });
  }

  return out.length > 1 ? out : segments;
}

function looksLikePtaCodeProblem(text: string): boolean {
  return /(?:函数接口定义：|裁判测试程序样例：|输入格式：|输出格式：|输入样例|输出样例|样例输入|样例输出|代码长度限制)/.test(text);
}

function cleanStructuredText(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/题目描述/g, " ")
    .replace(/分数\s*\d+/g, " ")
    .replace(/全屏浏览/g, " ")
    .replace(/切换布局/g, " ")
    .replace(/复制内容/g, " ")
    .replace(/格式/g, " ")
    .replace(/全屏/g, " ")
    .replace(/收起/g, " ")
    .replace(/\[\s*(?:in|out|C\+\+)\s*\]/gi, " ")
    .replace(/\b(?:\d+\s+){5,}\d+\b/g, " ")
    .replace(/\b\d+\s*▾\s*/g, " ")
    .replace(/(?:^|\s)\d+(?=\s*(?:#include|char|int\s+main|return|free|May|wrong input!))/g, " ")
    .replace(/(?:^|\s)(?:1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18)(?=\s+(?:char|#include|free|May|wrong input!))/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function splitStructuredSections(text: string): Array<{ label: string; text: string }> {
  const markers = [
    "函数接口定义：",
    "裁判测试程序样例：",
    "输入格式：",
    "输出格式：",
    "输入样例1：",
    "输出样例1：",
    "输入样例2：",
    "输出样例2：",
    "输入样例：",
    "输出样例：",
    "样例输入",
    "样例输出",
    "代码长度限制",
  ];
  const positions = markers
    .map((marker) => ({ marker, idx: text.indexOf(marker) }))
    .filter((entry) => entry.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  if (positions.length === 0) {
    return text ? [{ label: "题目描述", text }] : [];
  }

  const out: Array<{ label: string; text: string }> = [];
  const lead = cleanStructuredText(text.slice(0, positions[0].idx));
  if (lead) out.push({ label: "题目描述", text: lead });

  for (let i = 0; i < positions.length; i += 1) {
    const current = positions[i];
    const nextIdx = positions[i + 1]?.idx ?? text.length;
    const raw = cleanStructuredText(text.slice(current.idx + current.marker.length, nextIdx));
    if (!raw) continue;
    const label = normalizeStructuredLabel(current.marker);
    out.push({ label, text: normalizeStructuredSectionText(label, raw) });
  }

  return mergeSampleSections(out);
}

function normalizeStructuredLabel(marker: string): string {
  if (marker.startsWith("函数接口定义")) return "函数接口";
  if (marker.startsWith("裁判测试程序样例")) return "裁判样例";
  if (marker.startsWith("输入格式")) return "输入格式";
  if (marker.startsWith("输出格式")) return "输出格式";
  if (marker.startsWith("输入样例") || marker.startsWith("样例输入")) return "输入样例";
  if (marker.startsWith("输出样例") || marker.startsWith("样例输出")) return "输出样例";
  if (marker.startsWith("代码长度限制")) return "限制";
  return "内容";
}

function mergeSampleSections(sections: Array<{ label: string; text: string }>): Array<{ label: string; text: string }> {
  const merged: Array<{ label: string; text: string }> = [];
  for (const section of sections) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === section.label && /样例/.test(section.label)) {
      prev.text = `${prev.text}\n${section.text}`;
      continue;
    }
    merged.push({ ...section });
  }
  return merged;
}

function normalizeStructuredSectionText(label: string, text: string): string {
  let out = cleanStructuredText(text);
  if (!out) return "";

  if (label === "函数接口" || label === "裁判样例" || /样例/.test(label)) {
    out = out.replace(/^\d+\s+/, "");
    out = out.replace(/^▾\s*/, "");
  }

  if (/样例/.test(label)) {
    out = out.replace(/^(\S+)\s+(\S.*)$/, (_m, first, rest) => {
      return /^\d+$/.test(first) ? rest : `${first} ${rest}`;
    });
  }

  return out.trim();
}

function formatStructuredCode(text: string): string {
  const compact = String(text || "").trim();
  if (!compact) return "";

  let out = compact
    .replace(/\s*#include\s+/g, "\n#include ")
    .replace(/\s*#define\s+/g, "\n#define ")
    .replace(/\s*(\/\*.*?\*\/)\s*/g, "\n$1")
    .replace(/\s*{\s*/g, " {\n")
    .replace(/;\s*/g, ";\n")
    .replace(/\s*}\s*/g, "\n}\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  out = out
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return out;
}

function parseConstraintItems(text: string): Array<{ label: string; value: string }> {
  const source = String(text || "").trim();
  if (!source) return [];
  const patterns = [
    { label: "代码长度限制", re: /代码长度限制\s*([^\s]+(?:\s*[A-Za-z]+)?)/ },
    { label: "时间限制", re: /时间限制\s*([^\s]+(?:\s*[a-zA-Z]+)?)/ },
    { label: "内存限制", re: /内存限制\s*([^\s]+(?:\s*[A-Za-z]+)?)/ },
    { label: "栈限制", re: /栈限制\s*([^\s]+(?:\s*[A-Za-z]+)?)/ },
  ] as const;

  const items = patterns
    .map((item) => {
      const match = source.match(item.re);
      return match ? { label: item.label, value: match[1].replace(/\s{2,}/g, " ").trim() } : null;
    });
  const out = items.filter((item): item is NonNullable<(typeof items)[number]> => item !== null);
  if (!out.some((item) => item.label === "代码长度限制")) {
    const leading = source.match(/^([0-9]+(?:\s*[A-Za-z]+)?)/);
    if (leading) {
      out.unshift({ label: "代码长度限制", value: leading[1].replace(/\s{2,}/g, " ").trim() });
    }
  }
  return out;
}

function splitInterfaceSection(text: string): { code: string; prose: string } {
  const source = String(text || "").trim();
  const firstChineseIdx = source.search(/[\u4e00-\u9fff]/);
  if (firstChineseIdx < 0) return { code: source, prose: "" };
  return {
    code: source.slice(0, firstChineseIdx).trim(),
    prose: source.slice(firstChineseIdx).trim(),
  };
}

export const OptionRows: React.FC<{
  items: Array<{ key: string; value: string }>;
  accentColor: string;
  hintText?: string;
  lang: UILang;
  compact?: boolean;
}> = ({ items, accentColor, hintText, lang, compact = false }) => (
  <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
    {items.map((item, idx) => (
      <div
        key={`${item.key}-${idx}`}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          fontSize: compact ? 11 : 12,
          lineHeight: compact ? 1.5 : 1.6,
          color: "#edf3fb",
          padding: compact ? "7px 9px" : "8px 10px",
          borderRadius: 10,
          background: "rgba(15, 23, 42, 0.4)",
          border: "1px solid rgba(255, 255, 255, 0.04)",
        }}
      >
        <span style={{ color: accentColor, fontWeight: 800, minWidth: compact ? 18 : 32, width: compact ? 18 : undefined, flexShrink: 0 }}>{item.key}</span>
        <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {renderMathText(item.value || hintText || (lang === "en" ? "Blank" : "填空"))}
        </span>
      </div>
    ))}
  </div>
);

export const CandidateStatusHeader: React.FC<{
  cand: DetectedCandidate;
  index: number;
  lang: UILang;
  needsReview: boolean;
}> = ({ cand, index, lang, needsReview }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
    <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700 }}>#{index}</span>
    <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.04)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.06)" }}>
      {getTypeLabel(cand.block.questionTypeGuess, lang)}
    </span>
    {needsReview && (
      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 999, background: "linear-gradient(180deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05))", color: "#fef3c7", border: "1px solid rgba(245, 158, 11, 0.2)" }}>
        {lang === "en" ? "Needs review" : "建议复核"}
      </span>
    )}
    <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: STATUS_COLORS[cand.status] ?? "#94a3b8" }}>
      {(lang === "en" ? STATUS_LABELS_EN : STATUS_LABELS_ZH)[cand.status] ?? cand.status}
    </span>
  </div>
);

export const CandidateResultPanel: React.FC<{
  cand: DetectedCandidate;
  answerSummary: string;
  isExpanded: boolean;
  lang: UILang;
  onFill: () => void;
  onRetryVision: () => void;
  onToggleDetails: () => void;
}> = ({ cand, answerSummary, isExpanded, lang, onFill, onRetryVision, onToggleDetails }) => {
  if (cand.status !== "success" || !cand.result) return null;
  const extractionFailed = isStructuredAnswerExtractionFailed(cand.result);
  const displayAnswer = resolveResultAnswerForDisplay(cand.result, cand.block.questionTypeGuess, cand.block.previewText || cand.result.recognizedText || "");

  return (
    <>
      <div
        style={{
          marginTop: 12,
          padding: "10px 12px",
          borderRadius: 12,
          background: extractionFailed
            ? "linear-gradient(180deg, rgba(67, 40, 15, 0.8), rgba(45, 25, 10, 0.75))"
            : "linear-gradient(180deg, rgba(6, 40, 28, 0.8), rgba(5, 28, 20, 0.75))",
          border: extractionFailed
            ? "1px solid rgba(245, 158, 11, 0.2)"
            : "1px solid rgba(16, 185, 129, 0.2)",
          fontSize: 12,
          color: extractionFailed ? "#fde68a" : "#a7f3d0",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <strong>
          {extractionFailed
            ? (lang === "en" ? "Structured extraction failed" : "结构化提取失败")
            : `${lang === "en" ? "Answer" : "答案"}: ${displayAnswer}`}
        </strong>
        <div style={{ marginTop: 4, color: extractionFailed ? "#fcd34d" : "#6ee7b7" }}>
          {lang === "en" ? "Confidence" : "置信度"} {Math.round((cand.result.confidence ?? 0) * 100)}%
          {answerSummary ? <> | {renderMathText(answerSummary)}</> : ""}
        </div>
        {extractionFailed && (
          <div style={{ marginTop: 6, color: "#fbe58a" }}>
            {lang === "en"
              ? "The model returned content, but a stable structured answer was not extracted. Review details or retry with vision."
              : "模型返回了内容，但没有提取出稳定的结构化答案。请查看详情，或使用视觉重试。"}
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!extractionFailed) onFill();
            }}
            disabled={extractionFailed}
            style={{
              border: "1px solid rgba(255, 255, 255, 0.1)",
              background: extractionFailed
                ? "linear-gradient(180deg, rgba(148, 163, 184, 0.5), rgba(100, 116, 139, 0.38))"
                : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              color: "#ffffff",
              borderRadius: 10,
              fontSize: 11,
              fontWeight: 700,
              padding: "6px 10px",
              cursor: extractionFailed ? "not-allowed" : "pointer",
              opacity: extractionFailed ? 0.75 : 1,
              transition: "transform 0.2s ease, box-shadow 0.2s ease",
            }}
            title={extractionFailed
              ? (lang === "en" ? "Cannot fill because no stable structured answer was extracted" : "未提取到稳定结构化答案，暂不支持直接填写")
              : undefined}
          >
            {extractionFailed
              ? (lang === "en" ? "Fill unavailable" : "暂不可填写")
              : (lang === "en" ? "Fill answer" : "填写答案")}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleDetails();
          }}
          style={{
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))",
            backgroundColor: "transparent",
            color: "#f1f5f9",
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 700,
            padding: "6px 10px",
            cursor: "pointer",
            transition: "background 0.2s ease, border-color 0.2s ease",
          }}
        >
          {isExpanded ? (lang === "en" ? "Hide details" : "收起详情") : (lang === "en" ? "View details" : "查看详情")}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRetryVision();
          }}
          style={{
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))",
            backgroundColor: "transparent",
            color: "#f1f5f9",
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 700,
            padding: "6px 10px",
            cursor: "pointer",
            transition: "background 0.2s ease, border-color 0.2s ease",
          }}
        >
          {lang === "en" ? "Retry with Vision" : "视觉重试"}
        </button>
      </div>
      {isExpanded && (
        <div
          style={{
            marginTop: 8,
            padding: "10px 11px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.04)",
            background: "rgba(15, 23, 42, 0.4)",
            color: "#edf3fb",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {renderMathText(cand.result.detailedExplanation || cand.result.briefExplanation)}
        </div>
      )}
    </>
  );
};

export const CandidateErrorPanel: React.FC<{
  error?: string;
  lang: UILang;
  onRetryVision: () => void;
}> = ({ error, lang, onRetryVision }) => (
  <div style={{ marginTop: 10, padding: "10px 11px", borderRadius: 12, background: "linear-gradient(180deg, rgba(69, 26, 26, 0.8), rgba(45, 15, 15, 0.75))", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
    <div style={{ fontSize: 11, color: "#fca5a5", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.55 }}>{renderMathText(error?.slice(0, 160) || "")}</div>
    <div style={{ marginTop: 8 }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRetryVision();
        }}
        style={{
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background: "linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))",
          backgroundColor: "transparent",
          color: "#f1f5f9",
          borderRadius: 10,
          fontSize: 11,
          fontWeight: 700,
          padding: "6px 10px",
          cursor: "pointer",
          transition: "background 0.2s ease, border-color 0.2s ease",
        }}
      >
        {lang === "en" ? "Retry with Vision" : "视觉重试"}
      </button>
    </div>
  </div>
);
