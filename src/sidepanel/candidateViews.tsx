import { useState } from "react";
import type { DetectedCandidate, QuestionBlock } from "@/shared/types";
import {
  buildCandidateStemForDisplay,
  buildDisplaySegmentsForCandidate,
  cleanCandidatePreviewText,
  ensureBlankPlaceholders,
  formatQuestionTextForDisplay,
  getDisplayQuestionImageFromBlock,
  inferPreviewQuestionType,
  renderMathText,
  splitJudgeStemAndOptions,
  splitStemAndBlanks,
  splitStemAndOptions,
  type UILang,
} from "./displayUtils";
import { isRiskyCandidate } from "./batchParseHeuristics";
import {
  CandidateErrorPanel,
  CandidateResultPanel,
  CandidateStatusHeader,
  DisplaySegmentsView,
  getTypeLabel,
  OptionRows,
} from "./candidateViewParts";

export const CandidateCard: React.FC<{
  index: number;
  cand: DetectedCandidate;
  isExpanded: boolean;
  onToggle: () => void;
  onFlash: () => void;
  onToggleDetails: () => void;
  onFill: () => void;
  onRetryVision: () => void;
  lang: UILang;
}> = ({ index, cand, isExpanded, onToggle, onFlash, onToggleDetails, onFill, onRetryVision, lang }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const rawPreviewText = cand.block.previewText || "";
  const normalizedPreviewText = cleanCandidatePreviewText(rawPreviewText);
  const { stem, options } = splitStemAndOptions(normalizedPreviewText);
  const blankView = splitStemAndBlanks(normalizedPreviewText);
  const judgeView = splitJudgeStemAndOptions(normalizedPreviewText);
  const displaySegments = buildDisplaySegmentsForCandidate(cand.block, stem || normalizedPreviewText, rawPreviewText, lang);
  const displayStem = formatQuestionTextForDisplay(
    buildCandidateStemForDisplay(cand.block, stem || normalizedPreviewText, rawPreviewText, lang),
  );
  const fillBlankStem = formatQuestionTextForDisplay(ensureBlankPlaceholders(blankView.stem || normalizedPreviewText, blankView.blanks.length));
  const judgeStem = formatQuestionTextForDisplay(judgeView.stem || normalizedPreviewText);
  const answerSummary = formatQuestionTextForDisplay(cand.result?.briefExplanation || "");
  const displayImageUrl = displaySegments.some((segment) => segment.type === "image") ? "" : getDisplayQuestionImageFromBlock(cand.block);

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      style={{
        border: `1px solid ${cand.selected
          ? "rgba(99, 102, 241, 0.35)"
          : isHovered
            ? "rgba(255, 255, 255, 0.12)"
            : "rgba(255, 255, 255, 0.06)"}`,
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        background: cand.selected
          ? "linear-gradient(135deg, rgba(99, 102, 241, 0.16), rgba(139, 92, 246, 0.12))"
          : "linear-gradient(180deg, rgba(16, 24, 48, 0.75), rgba(10, 15, 30, 0.65))",
        cursor: "pointer",
        boxShadow: cand.selected
          ? (isPressed
              ? "0 4px 12px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255,255,255,0.08)"
              : isHovered
                ? "0 16px 36px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.12)"
                : "0 8px 24px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255,255,255,0.08)")
          : (isPressed
              ? "0 4px 10px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.06)"
              : isHovered
                ? "0 12px 28px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255,255,255,0.08)"
                : "0 4px 16px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.04)"),
        backdropFilter: "blur(20px)",
        position: "relative",
        overflow: "visible",
        transform: isPressed ? "translateY(1px) scale(0.996)" : isHovered ? "translateY(-2px)" : "translateY(0)",
        transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
        willChange: "transform, box-shadow",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 18,
          right: 18,
          bottom: -10,
          height: 20,
          borderRadius: 999,
          background: cand.selected
            ? "radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, rgba(0,0,0,0) 72%)"
            : "radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, rgba(0,0,0,0) 72%)",
          filter: "blur(12px)",
          opacity: isHovered ? 1 : 0.82,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: isHovered ? "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0) 26%)" : "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0) 24%)", pointerEvents: "none", transition: "background 0.18s ease" }} />
      <div style={{ position: "absolute", inset: 1, borderRadius: 15, border: "1px solid rgba(255,255,255,0.02)", pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            flexShrink: 0,
            marginTop: 2,
            border: `2px solid ${cand.selected ? "#818cf8" : "#64748b"}`,
            background: cand.selected ? "linear-gradient(180deg, #a5b4fc, #4f46e5)" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {cand.selected && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
        </div>

        <div style={{ flex: 1, minWidth: 0, borderRadius: 12, padding: "6px 6px 4px", background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.005))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)" }}>
          <CandidateStatusHeader cand={cand} index={index} lang={lang} needsReview={isRiskyCandidate(cand)} />

            <div style={{ fontSize: 12, color: "#e7edf5", lineHeight: 1.72, whiteSpace: "pre-wrap", wordBreak: "break-word", borderRadius: 12, padding: "4px 6px 0" }}>
            {displaySegments.length > 0
              ? <DisplaySegmentsView segments={displaySegments} lang={lang} />
              : renderMathText(
                (cand.block.questionTypeGuess === "fill_blank"
                  ? fillBlankStem
                  : cand.block.questionTypeGuess === "judge"
                    ? judgeStem
                  : displayStem) || (lang === "en" ? "(No preview text)" : "(无预览文本)"),
              )}
          </div>

          {displayImageUrl && (
            <div style={{ marginTop: 10 }}>
              <img
                src={displayImageUrl}
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
            </div>
          )}

          {cand.block.questionTypeGuess === "judge" && judgeView.options.length > 0 && (
            <OptionRows items={judgeView.options} accentColor="#f9c58f" lang={lang} />
          )}

          {cand.block.questionTypeGuess === "fill_blank" && blankView.blanks.length > 0 && (
            <OptionRows items={blankView.blanks.map((blank) => ({ key: blank.label, value: blank.hint }))} accentColor="#cba6f7" hintText={lang === "en" ? "Blank" : "填空"} lang={lang} />
          )}

          {options.length > 0 && (
            <OptionRows items={options.map((option) => ({ ...option, value: formatQuestionTextForDisplay(option.value) }))} accentColor="#89b4fa" lang={lang} />
          )}

          {(cand.debugInfo?.routeUsed || cand.debugInfo?.imageAttached !== undefined) && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#b7c4d3", padding: "0 6px" }}>
              {lang === "en" ? "Route" : "路由"}: {cand.debugInfo?.routeUsed ?? "-"} | {lang === "en" ? "Image attached" : "已附图片"}: {cand.debugInfo?.imageAttached ? (lang === "en" ? "Yes" : "是") : (lang === "en" ? "No" : "否")}
            </div>
          )}

          <CandidateResultPanel
            cand={cand}
            answerSummary={answerSummary}
            isExpanded={isExpanded}
            lang={lang}
            onFill={onFill}
            onRetryVision={onRetryVision}
            onToggleDetails={onToggleDetails}
          />

          {cand.status === "error" && <CandidateErrorPanel error={cand.error} lang={lang} onRetryVision={onRetryVision} />}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onFlash();
          }}
          style={{
            background: "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
            backgroundColor: "transparent",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            color: "#f1f5f9",
            cursor: "pointer",
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: 10,
            flexShrink: 0,
            boxShadow: isHovered ? "0 4px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.04)" : "inset 0 1px 0 rgba(255,255,255,0.02)",
            transition: "box-shadow 0.2s ease, transform 0.2s ease",
          }}
          title={lang === "en" ? "Locate on page" : "在页面中定位"}
        >
          {lang === "en" ? "Locate" : "定位"}
        </button>
      </div>
    </div>
  );
};

export const AutoSolvePreviewCard: React.FC<{ previewText: string; block?: QuestionBlock; lang: UILang }> = ({ previewText, block, lang }) => {
  const rawPreviewText = block?.previewText || previewText;
  const normalizedPreviewText = cleanCandidatePreviewText(rawPreviewText);
  const { stem, options } = splitStemAndOptions(normalizedPreviewText);
  const blankView = splitStemAndBlanks(normalizedPreviewText);
  const judgeView = splitJudgeStemAndOptions(normalizedPreviewText);
  const inferredType = block?.questionTypeGuess ?? inferPreviewQuestionType(normalizedPreviewText, options.length, blankView.blanks.length, judgeView.options.length);
  const displaySegments = block ? buildDisplaySegmentsForCandidate(block, stem || normalizedPreviewText, rawPreviewText, lang) : [];
  const displayStem = formatQuestionTextForDisplay(
    block ? buildCandidateStemForDisplay(block, stem || normalizedPreviewText, rawPreviewText, lang) : (stem || normalizedPreviewText),
  );
  const fillBlankStem = formatQuestionTextForDisplay(ensureBlankPlaceholders(blankView.stem || normalizedPreviewText, blankView.blanks.length));
  const judgeStem = formatQuestionTextForDisplay(judgeView.stem || normalizedPreviewText);
  const displayImageUrl = block && !displaySegments.some((segment) => segment.type === "image") ? getDisplayQuestionImageFromBlock(block) : "";

  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 11px",
        borderRadius: 16,
        background: "linear-gradient(180deg, rgba(16, 24, 48, 0.8), rgba(10, 15, 30, 0.85))",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0) 28%)", pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.04)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.06)" }}>
          {getTypeLabel(inferredType, lang, lang === "en" ? "Question" : "题目")}
        </span>
      </div>

      <div style={{ fontSize: 11, color: "#edf3fb", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {displaySegments.length > 0
          ? <DisplaySegmentsView segments={displaySegments} lang={lang} />
          : renderMathText(
            (inferredType === "fill_blank"
              ? fillBlankStem
              : inferredType === "judge"
                ? judgeStem
                : displayStem) || (lang === "en" ? "(No preview text)" : "(无预览文本)"),
          )}
      </div>

      {displayImageUrl && (
        <div style={{ marginTop: 10 }}>
          <img
            src={displayImageUrl}
            alt={lang === "en" ? "Question figure" : "题目配图"}
            style={{
              width: "100%",
              maxHeight: 220,
              objectFit: "contain",
              borderRadius: 12,
              border: "1px solid rgba(53, 92, 57, 0.6)",
              backgroundColor: "rgba(6, 12, 22, 0.92)",
            }}
          />
        </div>
      )}

      {inferredType === "judge" && judgeView.options.length > 0 && (
        <OptionRows items={judgeView.options} accentColor="#f9c58f" lang={lang} compact />
      )}

      {inferredType === "fill_blank" && blankView.blanks.length > 0 && (
        <OptionRows items={blankView.blanks.map((blank) => ({ key: blank.label, value: blank.hint }))} accentColor="#cba6f7" hintText={lang === "en" ? "Blank" : "填空"} lang={lang} compact />
      )}

      {options.length > 0 && (
        <OptionRows items={options.map((option) => ({ ...option, value: formatQuestionTextForDisplay(option.value) }))} accentColor="#89b4fa" lang={lang} compact />
      )}
    </div>
  );
};
