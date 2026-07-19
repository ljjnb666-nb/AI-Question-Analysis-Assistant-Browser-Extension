import React from "react";
import type { HistoryEntry, QuestionType } from "@/shared/types";
import { UiButton } from "@/shared/ui/extensionUi";
import {
  ensureBlankPlaceholders,
  formatQuestionTextForDisplay,
  getDisplayQuestionImage,
  getDisplayType,
  historyOptionStyle,
  historyStemStyle,
  normalizeHistoryAnswer,
  normalizeText,
  renderMathText,
  splitJudgeStemAndOptions,
  splitStemAndBlanks,
  splitStemAndOptions,
  type UILang,
} from "./displayUtils";
import { historyCardStyle, PanelChrome } from "./sidepanelTheme";

export const HistoryEmptyState: React.FC<{ lang: UILang }> = ({ lang }) => (
  <div className="history-card" style={{ ...historyCardStyle, marginTop: 12, padding: "18px 16px", color: "#8da0b8", fontSize: 13, lineHeight: 1.6 }}>
    {lang === "en" ? "No history yet. Solved questions will appear here." : "还没有历史记录，完成解析后会出现在这里。"}
  </div>
);

export const HistoryToolbarCard: React.FC<{
  lang: UILang;
  onClear: () => void;
  onExport: () => void;
}> = ({ lang, onClear, onExport }) => (
  <div
    className="history-head"
    style={{
      ...historyCardStyle,
      padding: 12,
      marginBottom: 10,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 10,
      position: "relative",
      overflow: "hidden",
    }}
  >
    <PanelChrome glow="rgba(99, 102, 241, 0.16)" overlay="linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0) 28%)" />
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#eef4fb" }}>{lang === "en" ? "Parse History" : "解析历史"}</div>
      <div style={{ fontSize: 11, color: "#8da0b8", marginTop: 4, lineHeight: 1.55 }}>
        {lang === "en" ? "Export records or clear old results when you want a clean workspace." : "需要时可以导出记录，也可以清理旧结果。"}
      </div>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <UiButton onClick={onExport}>{lang === "en" ? "Export JSON" : "导出 JSON"}</UiButton>
      <UiButton onClick={onClear}>{lang === "en" ? "Clear History" : "清空历史"}</UiButton>
    </div>
  </div>
);

export const HistoryRecordCard: React.FC<{
  entry: HistoryEntry;
  lang: UILang;
  onToggleDetails: (id: string) => void;
  showDetails: boolean;
}> = ({ entry, lang, onToggleDetails, showDetails }) => {
  const dtype = getDisplayType(entry);
  const rawSourceText = entry.result.recognizedText || entry.block.previewText || "";
  const sourceText = normalizeText(rawSourceText);
  const prettySourceText = formatQuestionTextForDisplay(rawSourceText);
  const { stem, options } = splitStemAndOptions(sourceText);
  const blankView = splitStemAndBlanks(sourceText);
  const judgeView = splitJudgeStemAndOptions(sourceText);
  const fillBlankStem = formatQuestionTextForDisplay(ensureBlankPlaceholders(blankView.stem || sourceText, blankView.blanks.length));
  const prettyImageUrl = getDisplayQuestionImage(entry);

  return (
    <div className="history-card" style={{ ...historyCardStyle, padding: "12px 12px 10px", marginBottom: 10, position: "relative", overflow: "hidden" }}>
      <PanelChrome glow="rgba(99, 102, 241, 0.16)" overlay="linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0) 28%)" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "#7d8ea6" }}>{new Date(entry.timestamp).toLocaleString(lang === "en" ? "en-US" : "zh-CN")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <TypeBadge type={dtype} lang={lang} />
          <div style={{ fontSize: 12, color: "#eef4fb", fontWeight: 700 }}>
            {lang === "en" ? "Answer" : "答案"}: <span style={{ color: "#ffd6af" }}>{normalizeHistoryAnswer(entry, dtype)}</span>
          </div>
        </div>
      </div>

      {prettyImageUrl ? (
        <div style={{ marginBottom: 8 }}>
          <img
            src={prettyImageUrl}
            alt={lang === "en" ? "Question figure" : "题目配图"}
            style={{
              width: "100%",
              maxHeight: 220,
              objectFit: "contain",
              borderRadius: 12,
              border: "1px solid rgba(138, 151, 173, 0.14)",
              backgroundColor: "rgba(10, 16, 28, 0.92)",
            }}
          />
        </div>
      ) : null}

      <HistoryQuestionContent
        blankView={blankView}
        dtype={dtype}
        fillBlankStem={fillBlankStem}
        judgeView={judgeView}
        lang={lang}
        options={options}
        prettySourceText={prettySourceText}
        sourceText={sourceText}
        stem={stem}
      />

      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => onToggleDetails(entry.id)}
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
          {showDetails ? (lang === "en" ? "Hide details" : "收起详情") : lang === "en" ? "View details" : "查看详情"}
        </button>
        <div style={{ fontSize: 10, color: "#8da0b8" }}>
          {lang === "en" ? "Confidence" : "置信度"} {Math.round((entry.result.confidence ?? 0) * 100)}%
        </div>
      </div>

      {showDetails ? (
        <div
          style={{
            marginTop: 8,
            padding: "10px 11px",
            borderRadius: 10,
            border: "1px solid rgba(255, 255, 255, 0.04)",
            background: "rgba(15, 23, 42, 0.4)",
            color: "#edf3fb",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {entry.result.detailedExplanation || entry.result.briefExplanation || (lang === "en" ? "(No detailed explanation)" : "(无详细解析)")}
        </div>
      ) : null}
    </div>
  );
};

const HistoryQuestionContent: React.FC<{
  blankView: ReturnType<typeof splitStemAndBlanks>;
  dtype: QuestionType;
  fillBlankStem: string;
  judgeView: ReturnType<typeof splitJudgeStemAndOptions>;
  lang: UILang;
  options: ReturnType<typeof splitStemAndOptions>["options"];
  prettySourceText: string;
  sourceText: string;
  stem: string;
}> = ({ blankView, dtype, fillBlankStem, judgeView, lang, options, prettySourceText, sourceText, stem }) => {
  if (dtype === "single_choice" || dtype === "multi_choice") {
    return (
      <>
        <div style={historyStemStyle}>{renderMathText(formatQuestionTextForDisplay(stem || sourceText) || (lang === "en" ? "(No stem)" : "(无题干)"))}</div>
        <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
          {options.length > 0 ? options.map((op) => <HistoryOptionRow key={op.key} label={op.key} value={op.value} />) : <div style={{ color: "#8da0b8", fontSize: 12 }}>{lang === "en" ? "No standard option structure extracted" : "未提取到标准选项结构"}</div>}
        </div>
      </>
    );
  }

  if (dtype === "judge") {
    return (
      <>
        <div style={historyStemStyle}>{renderMathText(formatQuestionTextForDisplay(judgeView.stem || sourceText) || (lang === "en" ? "(No stem)" : "(无题干)"))}</div>
        {judgeView.options.length > 0 ? <div style={{ display: "grid", gap: 4, marginTop: 6 }}>{judgeView.options.map((op) => <HistoryOptionRow key={op.key} label={op.key} value={op.value} />)}</div> : null}
      </>
    );
  }

  return (
    <>
      <div style={historyStemStyle}>
        {renderMathText(dtype === "fill_blank" ? fillBlankStem || (lang === "en" ? "(No stem)" : "(无题干)") : prettySourceText || (lang === "en" ? "(No stem)" : "(无题干)"))}
      </div>
      {dtype === "fill_blank" && blankView.blanks.length > 0 ? (
        <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
          {blankView.blanks.map((blank, index) => (
            <HistoryOptionRow key={`${blank.label}-${index}`} label={blank.label} value={blank.hint || (lang === "en" ? "Blank" : "填空")} wideLabel />
          ))}
        </div>
      ) : null}
    </>
  );
};

const HistoryOptionRow: React.FC<{
  label: string;
  value?: string;
  wideLabel?: boolean;
}> = ({ label, value, wideLabel = false }) => (
  <div
    style={{
      ...historyOptionStyle,
      background: "rgba(15, 23, 42, 0.4)",
      border: "1px solid rgba(255, 255, 255, 0.04)",
      borderRadius: 10,
      padding: "8px 10px",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
    }}
  >
    <span style={{ color: "#ffd6af", fontWeight: 700, width: wideLabel ? 32 : 18 }}>{label}</span>
    {value ? <span style={{ color: "#dbe4ef" }}>{renderMathText(value)}</span> : null}
  </div>
);

const TypeBadge: React.FC<{ type: QuestionType; lang: UILang }> = ({ type, lang }) => {
  const map: Record<QuestionType, { text: string; bg: string; fg: string }> = {
    single_choice: { text: lang === "en" ? "Single" : "单选", bg: "rgba(255, 255, 255, 0.04)", fg: "#f1f5f9" },
    multi_choice: { text: lang === "en" ? "Multi" : "多选", bg: "rgba(255, 255, 255, 0.04)", fg: "#f1f5f9" },
    judge: { text: lang === "en" ? "Judge" : "判断", bg: "rgba(255, 255, 255, 0.04)", fg: "#f1f5f9" },
    fill_blank: { text: lang === "en" ? "Blank" : "填空", bg: "rgba(255, 255, 255, 0.04)", fg: "#f1f5f9" },
    short_answer: { text: lang === "en" ? "Short" : "简答", bg: "rgba(255, 255, 255, 0.04)", fg: "#f1f5f9" },
    unknown: { text: lang === "en" ? "Unknown" : "未知", bg: "rgba(255, 255, 255, 0.04)", fg: "#f1f5f9" },
  };
  const style = map[type];

  return (
    <span style={{ fontSize: 10, padding: "4px 8px", borderRadius: 999, backgroundColor: style.bg, color: style.fg, border: "1px solid rgba(255, 255, 255, 0.06)" }}>
      {style.text}
    </span>
  );
};
