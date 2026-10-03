import type { CSSProperties } from "react";
import type { QuestionBlock } from "@/shared/types";
import { orbitColors, orbitRadius, orbitSpacing, orbitTypography } from "@/shared/ui/orbitTokens";
import { DisplaySegmentsView } from "./candidateViewParts";
import { buildDisplaySegmentsForCandidate, cleanCandidatePreviewText, ensureBlankPlaceholders, formatQuestionTextForDisplay,
  getDisplayQuestionImageFromBlock, renderMathText, splitJudgeStemAndOptions, splitStemAndBlanks, splitStemAndOptions, type UILang } from "./displayUtils";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";

export const CANDIDATE_TEXT_STYLE: CSSProperties = {
  minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word",
  fontSize: orbitTypography.fontSize.md, lineHeight: orbitTypography.lineHeight.relaxed, color: orbitColors.text.primary,
};

function CandidateOptions({ items }: { items: Array<{ key: string; value: string }> }) {
  return <div style={{ display: "grid", gap: orbitSpacing[1] }}>
    {items.map((item, index) => <div key={`${item.key}-${index}`} style={{ display: "flex", gap: orbitSpacing[2], padding: orbitSpacing[2], borderRadius: orbitRadius.sm, background: orbitColors.bg.surfaceSubtle }}>
      <strong style={{ flexShrink: 0, color: orbitColors.text.secondary }}>{item.key}</strong>
      <span style={{ ...CANDIDATE_TEXT_STYLE, flex: 1 }}>{renderMathText(formatQuestionTextForDisplay(item.value))}</span>
    </div>)}
  </div>;
}

export function CandidateQuestionContent({ block, lang }: { block: QuestionBlock; lang: UILang }) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const normalized = cleanCandidatePreviewText(block.previewText || "");
  const choice = splitStemAndOptions(normalized);
  const blanks = splitStemAndBlanks(normalized);
  const judge = splitJudgeStemAndOptions(normalized);
  const segments = buildDisplaySegmentsForCandidate(block, choice.stem || normalized, block.previewText || "", lang);
  // Keep the complete source stem. Image-oriented compact previews are not
  // sufficient for reviewing an answer and must not hide available text.
  const stem = block.questionTypeGuess === "fill_blank" ? ensureBlankPlaceholders(blanks.stem || normalized, blanks.blanks.length)
    : block.questionTypeGuess === "judge" ? judge.stem || normalized : choice.stem || normalized;
  const options = block.questionTypeGuess === "judge" ? judge.options
    : block.questionTypeGuess === "fill_blank" ? blanks.blanks.map(blank => ({ key: blank.label, value: blank.hint })) : choice.options;
  const fallbackImage = segments.some(segment => segment.type === "image") ? "" : getDisplayQuestionImageFromBlock(block);
  const hasImage = !!fallbackImage || segments.some(segment => segment.type === "image");
  return <div style={{ display: "grid", gap: orbitSpacing[2], ...CANDIDATE_TEXT_STYLE }}>
    {segments.length > 0 ? <DisplaySegmentsView segments={segments} lang={lang} /> : <div>{renderMathText(formatQuestionTextForDisplay(stem) || copy.noPreview)}</div>}
    {fallbackImage && <DisplaySegmentsView segments={[{ type: "image", url: fallbackImage }]} lang={lang} />}
    {options.length > 0 && <CandidateOptions items={options} />}
    {block.hasImage && !hasImage && <p style={{ margin: 0, color: orbitColors.text.secondary, fontSize: orbitTypography.fontSize.sm }}>{copy.imageUnavailable}</p>}
  </div>;
}
