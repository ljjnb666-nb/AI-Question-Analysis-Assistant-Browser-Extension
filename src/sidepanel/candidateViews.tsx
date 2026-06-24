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
      style={{
        border: `1px solid ${cand.selected ? "#4f9cf9" : "#313244"}`,
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 8,
        backgroundColor: cand.selected ? "#1c2a3a" : "#181825",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            flexShrink: 0,
            marginTop: 2,
            border: `2px solid ${cand.selected ? "#4f9cf9" : "#45475a"}`,
            backgroundColor: cand.selected ? "#4f9cf9" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {cand.selected && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>?</span>}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <CandidateStatusHeader cand={cand} index={index} lang={lang} needsReview={isRiskyCandidate(cand)} />

          <div style={{ fontSize: 12, color: "#dce0ff", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {displaySegments.length > 0
              ? <DisplaySegmentsView segments={displaySegments} lang={lang} />
              : renderMathText(
                (cand.block.questionTypeGuess === "fill_blank"
                  ? fillBlankStem
                  : cand.block.questionTypeGuess === "judge"
                    ? judgeStem
                    : displayStem) || (lang === "en" ? "(No preview text)" : "(鏃犻瑙堟枃鏈?)"),
              )}
          </div>

          {displayImageUrl && (
            <div style={{ marginTop: 8 }}>
              <img
                src={displayImageUrl}
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
            </div>
          )}

          {cand.block.questionTypeGuess === "judge" && judgeView.options.length > 0 && (
            <OptionRows items={judgeView.options} accentColor="#f9c58f" lang={lang} />
          )}

          {cand.block.questionTypeGuess === "fill_blank" && blankView.blanks.length > 0 && (
            <OptionRows items={blankView.blanks.map((blank) => ({ key: blank.label, value: blank.hint }))} accentColor="#cba6f7" hintText={lang === "en" ? "Blank" : "濉┖"} lang={lang} />
          )}

          {options.length > 0 && (
            <OptionRows items={options.map((option) => ({ ...option, value: formatQuestionTextForDisplay(option.value) }))} accentColor="#89b4fa" lang={lang} />
          )}

          {(cand.debugInfo?.routeUsed || cand.debugInfo?.imageAttached !== undefined) && (
            <div style={{ marginTop: 6, fontSize: 10, color: "#6c7086" }}>
              {lang === "en" ? "Route" : "璺敱"}: {cand.debugInfo?.routeUsed ?? "-"} |{" "}
              {lang === "en" ? "Image attached" : "宸查檮鍥?"}: {cand.debugInfo?.imageAttached ? (lang === "en" ? "Yes" : "鏄?)") : (lang === "en" ? "No" : "鍚?)")}
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
          style={{ background: "none", border: "none", color: "#6c7086", cursor: "pointer", fontSize: 12, padding: "2px", flexShrink: 0 }}
          title={lang === "en" ? "Locate on page" : "鍦ㄩ〉闈腑瀹氫綅"}
        >
          {lang === "en" ? "Locate" : "瀹氫綅"}
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
        marginTop: 8,
        padding: "8px 9px",
        borderRadius: 6,
        backgroundColor: "#162116",
        border: "1px solid #355c39",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, backgroundColor: "#223622", color: "#8fe39a" }}>
          {getTypeLabel(inferredType, lang, lang === "en" ? "Question" : "棰樼洰")}
        </span>
      </div>

      <div style={{ fontSize: 11, color: "#d5f5da", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {displaySegments.length > 0
          ? <DisplaySegmentsView segments={displaySegments} lang={lang} />
          : renderMathText(
            (inferredType === "fill_blank"
              ? fillBlankStem
              : inferredType === "judge"
                ? judgeStem
                : displayStem) || (lang === "en" ? "(No preview text)" : "(鏃犻瑙堟枃鏈?)"),
          )}
      </div>

      {displayImageUrl && (
        <div style={{ marginTop: 8 }}>
          <img
            src={displayImageUrl}
            alt={lang === "en" ? "Question figure" : "棰樼洰閰嶅浘"}
            style={{
              width: "100%",
              maxHeight: 220,
              objectFit: "contain",
              borderRadius: 8,
              border: "1px solid #355c39",
              backgroundColor: "#11111b",
            }}
          />
        </div>
      )}

      {inferredType === "judge" && judgeView.options.length > 0 && (
        <OptionRows items={judgeView.options} accentColor="#f9c58f" lang={lang} compact />
      )}

      {inferredType === "fill_blank" && blankView.blanks.length > 0 && (
        <OptionRows items={blankView.blanks.map((blank) => ({ key: blank.label, value: blank.hint }))} accentColor="#cba6f7" hintText={lang === "en" ? "Blank" : "濉┖"} lang={lang} compact />
      )}

      {options.length > 0 && (
        <OptionRows items={options.map((option) => ({ ...option, value: formatQuestionTextForDisplay(option.value) }))} accentColor="#89b4fa" lang={lang} compact />
      )}
    </div>
  );
};
