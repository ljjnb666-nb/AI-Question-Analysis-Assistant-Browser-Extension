import React, { useEffect, useState } from "react";
import type { HistoryEntry, QuestionType } from "@/shared/types";
import { clearHistory, exportHistory } from "@/shared/utils/storage";
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

type HistoryItem = HistoryEntry;

const actionButtonStyle: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 7,
  border: "none",
  cursor: "pointer",
  backgroundColor: "#313244",
  color: "#cdd6f4",
  fontSize: 12,
  fontWeight: 400,
  fontFamily: "system-ui, sans-serif",
};

export const HistoryTab: React.FC<{ lang: UILang }> = ({ lang }) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const reload = () => {
      chrome.storage.local.get("parseHistory").then((r) => {
        setHistory((r.parseHistory as HistoryItem[]) ?? []);
      });
    };

    reload();

    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === "local" && changes.parseHistory) reload();
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const handleClear = async () => {
    await clearHistory();
    setHistory([]);
    setExpandedIds({});
  };

  const handleExport = async () => {
    const json = await exportHistory();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quiz-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!history.length) {
    return <div style={{ textAlign: "center", padding: "32px 16px", color: "#6c7086" }}>{lang === "en" ? "No history yet" : "\u6682\u65e0\u89e3\u6790\u5386\u53f2"}</div>;
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
        <button onClick={handleExport} style={actionButtonStyle}>{lang === "en" ? "Export JSON" : "\u5bfc\u51fa JSON"}</button>
        <button onClick={handleClear} style={actionButtonStyle}>{lang === "en" ? "Clear History" : "\u6e05\u7a7a\u5386\u53f2"}</button>
      </div>

      {history.map((entry) => {
        const dtype = getDisplayType(entry);
        const rawSourceText = entry.result.recognizedText || entry.block.previewText || "";
        const sourceText = normalizeText(rawSourceText);
        const prettySourceText = formatQuestionTextForDisplay(rawSourceText);
        const { stem, options } = splitStemAndOptions(sourceText);
        const blankView = splitStemAndBlanks(sourceText);
        const judgeView = splitJudgeStemAndOptions(sourceText);
        const fillBlankStem = formatQuestionTextForDisplay(ensureBlankPlaceholders(blankView.stem || sourceText, blankView.blanks.length));
        const prettyImageUrl = getDisplayQuestionImage(entry);
        const showDetails = !!expandedIds[entry.id];

        return (
          <div
            key={entry.id}
            style={{
              border: "1px solid #313244",
              borderRadius: 12,
              padding: "12px 12px 10px",
              marginBottom: 12,
              backgroundColor: "#181825",
              boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: "#8b8ea3" }}>{new Date(entry.timestamp).toLocaleString(lang === "en" ? "en-US" : "zh-CN")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TypeBadge type={dtype} lang={lang} />
                <div style={{ fontSize: 12, color: "#a6e3a1", fontWeight: 700 }}>{lang === "en" ? "Answer" : "\u7b54\u6848"}: {normalizeHistoryAnswer(entry, dtype)}</div>
              </div>
            </div>

            {prettyImageUrl && (
              <div style={{ marginBottom: 8 }}>
                <img
                  src={prettyImageUrl}
                  alt={lang === "en" ? "Question figure" : "\u9898\u76ee\u914d\u56fe"}
                  style={{
                    width: "100%",
                    maxHeight: 220,
                    objectFit: "contain",
                    borderRadius: 8,
                    border: "1px solid #313244",
                    backgroundColor: "#11111b",
                  }}
                />
              </div>
            )}

            {(dtype === "single_choice" || dtype === "multi_choice") && (
              <>
                <div style={historyStemStyle}>{renderMathText(formatQuestionTextForDisplay(stem || sourceText) || (lang === "en" ? "(No stem)" : "(\u65e0\u9898\u5e72)"))}</div>
                <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                  {options.length > 0
                    ? options.map((op) => (
                        <div key={op.key} style={historyOptionStyle}>
                          <span style={{ color: "#89b4fa", fontWeight: 700, width: 18 }}>{op.key}</span>
                          <span style={{ color: "#cdd6f4" }}>{renderMathText(op.value)}</span>
                        </div>
                      ))
                    : <div style={{ color: "#a6adc8", fontSize: 12 }}>{lang === "en" ? "No standard option structure extracted" : "\u672a\u63d0\u53d6\u5230\u6807\u51c6\u9009\u9879\u7ed3\u6784"}</div>}
                </div>
              </>
            )}

            {dtype === "judge" && (
              <>
                <div style={historyStemStyle}>{renderMathText(formatQuestionTextForDisplay(judgeView.stem || sourceText) || (lang === "en" ? "(No stem)" : "(\u65e0\u9898\u5e72)"))}</div>
                {judgeView.options.length > 0 && (
                  <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                    {judgeView.options.map((op) => (
                      <div key={op.key} style={historyOptionStyle}>
                        <span style={{ color: "#f9c58f", fontWeight: 700, width: 18 }}>{op.key}</span>
                        {op.value ? <span style={{ color: "#cdd6f4" }}>{renderMathText(op.value)}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {(dtype === "fill_blank" || dtype === "short_answer" || dtype === "unknown") && (
              <>
                <div style={historyStemStyle}>
                  {renderMathText(
                    dtype === "fill_blank"
                      ? fillBlankStem || (lang === "en" ? "(No stem)" : "(\u65e0\u9898\u5e72)")
                      : prettySourceText || (lang === "en" ? "(No stem)" : "(\u65e0\u9898\u5e72)"),
                  )}
                </div>
                {dtype === "fill_blank" && blankView.blanks.length > 0 && (
                  <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                    {blankView.blanks.map((blank, idx) => (
                      <div key={`${blank.label}-${idx}`} style={historyOptionStyle}>
                        <span style={{ color: "#cba6f7", fontWeight: 700, width: 32 }}>{blank.label}</span>
                        <span style={{ color: "#cdd6f4" }}>{renderMathText(blank.hint || (lang === "en" ? "Blank" : "\u586b\u7a7a"))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setExpandedIds((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
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
                {showDetails ? (lang === "en" ? "Hide details" : "\u6536\u8d77\u8be6\u60c5") : (lang === "en" ? "View details" : "\u67e5\u770b\u8be6\u60c5")}
              </button>
              <div style={{ fontSize: 10, color: "#6c7086" }}>
                {lang === "en" ? "Confidence" : "\u7f6e\u4fe1\u5ea6"} {Math.round((entry.result.confidence ?? 0) * 100)}%
              </div>
            </div>

            {showDetails && (
              <div
                style={{
                  marginTop: 6,
                  padding: "8px",
                  borderRadius: 6,
                  border: "1px solid #313244",
                  backgroundColor: "#11111b",
                  color: "#cdd6f4",
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {entry.result.detailedExplanation || entry.result.briefExplanation || (lang === "en" ? "(No detailed explanation)" : "(\u65e0\u8be6\u7ec6\u89e3\u6790)")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const TypeBadge: React.FC<{ type: QuestionType; lang: UILang }> = ({ type, lang }) => {
  const map: Record<QuestionType, { text: string; bg: string; fg: string }> = {
    single_choice: { text: lang === "en" ? "Single" : "\u5355\u9009", bg: "#1d2a3d", fg: "#89b4fa" },
    multi_choice: { text: lang === "en" ? "Multi" : "\u591a\u9009", bg: "#23301f", fg: "#a6e3a1" },
    judge: { text: lang === "en" ? "Judge" : "\u5224\u65ad", bg: "#36241c", fg: "#f9c58f" },
    fill_blank: { text: lang === "en" ? "Blank" : "\u586b\u7a7a", bg: "#2d2236", fg: "#cba6f7" },
    short_answer: { text: lang === "en" ? "Short" : "\u7b80\u7b54", bg: "#2a2a2a", fg: "#f2cdcd" },
    unknown: { text: lang === "en" ? "Unknown" : "\u672a\u77e5", bg: "#2b2d40", fg: "#bac2de" },
  };
  const s = map[type];
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, backgroundColor: s.bg, color: s.fg }}>
      {s.text}
    </span>
  );
};
