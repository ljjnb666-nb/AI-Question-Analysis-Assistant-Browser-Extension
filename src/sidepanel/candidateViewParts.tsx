import type { DetectedCandidate, QuestionDisplaySegment, QuestionType } from "@/shared/types";
import { formatQuestionTextForDisplay, renderMathText, resolveResultAnswerForDisplay, type UILang } from "./displayUtils";

const STATUS_COLORS: Record<string, string> = {
  idle: "#45475a",
  loading: "#f9e2af",
  success: "#a6e3a1",
  error: "#f38ba8",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "寰呰В鏋?",
  loading: "瑙ｆ瀽涓?..",
  success: "瀹屾垚",
  error: "澶辫触",
};

const STATUS_LABELS_EN: Record<string, string> = {
  idle: "Pending",
  loading: "Parsing...",
  success: "Done",
  error: "Failed",
};

const TYPE_LABELS: Record<string, string> = {
  single_choice: "鍗曢€?",
  multi_choice: "澶氶€?",
  judge: "鍒ゆ柇",
  fill_blank: "濉┖",
  short_answer: "绠€绛?",
  unknown: "鏈煡",
};

const TYPE_LABELS_EN: Record<string, string> = {
  single_choice: "Single",
  multi_choice: "Multi",
  judge: "Judge",
  fill_blank: "Blank",
  short_answer: "Short",
  unknown: "Unknown",
};

export function getTypeLabel(questionType: QuestionType, lang: UILang, fallback = "?") {
  return (lang === "en" ? TYPE_LABELS_EN : TYPE_LABELS)[questionType] ?? fallback;
}

export const DisplaySegmentsView: React.FC<{ segments: QuestionDisplaySegment[]; lang: UILang }> = ({ segments, lang }) => (
  <div style={{ display: "grid", gap: 8 }}>
    {segments.map((segment, idx) => (
      segment.type === "image" ? (
        <img
          key={`${segment.type}-${idx}`}
          src={segment.url}
          alt={lang === "en" ? "Question figure" : "棰樼洰閰嶅浘"}
          style={{
            width: "100%",
            maxHeight: 220,
            objectFit: "contain",
            borderRadius: 8,
            border: "1px solid #313244",
            backgroundColor: "#11111b",
          }}
        />
      ) : (
        <div key={`${segment.type}-${idx}`}>{renderMathText(formatQuestionTextForDisplay(segment.text))}</div>
      )
    ))}
  </div>
);

export const OptionRows: React.FC<{
  items: Array<{ key: string; value: string }>;
  accentColor: string;
  hintText?: string;
  lang: UILang;
  compact?: boolean;
}> = ({ items, accentColor, hintText, lang, compact = false }) => (
  <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
    {items.map((item, idx) => (
      <div
        key={`${item.key}-${idx}`}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          fontSize: compact ? 11 : 12,
          lineHeight: compact ? 1.5 : 1.55,
          color: compact ? "#cbe9ce" : "#bac2de",
          padding: "4px 8px",
          borderRadius: 6,
          backgroundColor: compact ? "#111a11" : "#11111b",
          border: `1px solid ${compact ? "#2a442e" : "#313244"}`,
        }}
      >
        <span style={{ color: accentColor, fontWeight: 700, minWidth: compact ? 18 : 32, width: compact ? 18 : undefined, flexShrink: 0 }}>{item.key}</span>
        <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {renderMathText(item.value || hintText || (lang === "en" ? "Blank" : "濉┖"))}
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
  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
    <span style={{ color: "#6c7086", fontSize: 11 }}>#{index}</span>
    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, backgroundColor: "#313244", color: "#89b4fa" }}>
      {getTypeLabel(cand.block.questionTypeGuess, lang)}
    </span>
    {needsReview && (
      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, backgroundColor: "#36241c", color: "#f9c58f" }}>
        {lang === "en" ? "Needs review" : "寤鸿澶嶆牳"}
      </span>
    )}
    <span style={{ marginLeft: "auto", fontSize: 10, color: STATUS_COLORS[cand.status] ?? "#45475a" }}>
      {(lang === "en" ? STATUS_LABELS_EN : STATUS_LABELS)[cand.status] ?? cand.status}
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

  return (
    <>
      <div
        style={{
          marginTop: 8,
          padding: "8px 10px",
          borderRadius: 6,
          backgroundColor: "#1e3a2e",
          border: "1px solid #2d5a3d",
          fontSize: 12,
          color: "#a6e3a1",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <strong>{lang === "en" ? "Answer" : "绛旀"}: {renderMathText(resolveResultAnswerForDisplay(cand.result, cand.block.questionTypeGuess, cand.block.previewText || cand.result.recognizedText || ""))}</strong>
        <div style={{ marginTop: 4, color: "#cfecc8" }}>
          {lang === "en" ? "Confidence" : "缃俊搴?"} {Math.round((cand.result.confidence ?? 0) * 100)}%
          {answerSummary ? <> | {renderMathText(answerSummary)}</> : ""}
        </div>
        <div style={{ marginTop: 6 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFill();
            }}
            style={{
              border: "1px solid #5bc28c",
              background: "#173524",
              color: "#b8f0cc",
              borderRadius: 6,
              fontSize: 11,
              padding: "3px 8px",
              cursor: "pointer",
            }}
          >
            {lang === "en" ? "Fill answer" : "濉啓绛旀"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 6 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleDetails();
          }}
          style={{
            border: "1px solid #45475a",
            background: "transparent",
            color: "#89b4fa",
            borderRadius: 6,
            fontSize: 11,
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          {isExpanded ? (lang === "en" ? "Hide details" : "鏀惰捣璇︽儏") : (lang === "en" ? "View details" : "鏌ョ湅璇︽儏")}
        </button>
        {isExpanded && (
          <div
            style={{
              marginTop: 6,
              padding: "8px",
              borderRadius: 6,
              border: "1px solid #313244",
              backgroundColor: "#11111b",
              color: "#cdd6f4",
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {renderMathText(cand.result.detailedExplanation || cand.result.briefExplanation)}
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRetryVision();
          }}
          style={{
            display: "block",
            marginTop: 6,
            border: "1px solid #7c5cff",
            background: "#2b1f52",
            color: "#d9ccff",
            borderRadius: 6,
            fontSize: 11,
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          {lang === "en" ? "Retry with Vision" : "瑙嗚閲嶈瘯"}
        </button>
      </div>
    </>
  );
};

export const CandidateErrorPanel: React.FC<{
  error?: string;
  lang: UILang;
  onRetryVision: () => void;
}> = ({ error, lang, onRetryVision }) => (
  <div style={{ marginTop: 6 }}>
    <div style={{ fontSize: 11, color: "#f38ba8", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderMathText(error?.slice(0, 160) || "")}</div>
    <div style={{ marginTop: 6 }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRetryVision();
        }}
        style={{
          border: "1px solid #7c5cff",
          background: "#2b1f52",
          color: "#d9ccff",
          borderRadius: 6,
          fontSize: 11,
          padding: "2px 8px",
          cursor: "pointer",
        }}
      >
        {lang === "en" ? "Retry with Vision" : "瑙嗚閲嶈瘯"}
      </button>
    </div>
  </div>
);
