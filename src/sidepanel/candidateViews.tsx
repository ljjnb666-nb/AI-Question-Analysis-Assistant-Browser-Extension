import type { QuestionBlock } from "@/shared/types";
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
import {
  DisplaySegmentsView,
  getTypeLabel,
  OptionRows,
} from "./candidateViewParts";

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
