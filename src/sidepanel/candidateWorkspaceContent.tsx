import React, { useId, useState, type CSSProperties } from "react";
import { OrbitButton } from "@/shared/ui/orbitPrimitives";
import type { QuestionBlock } from "@/shared/types";
import { orbitColors, orbitRadius, orbitSpacing, orbitTypography } from "@/shared/ui/orbitTokens";
import { DisplaySegmentsView } from "./candidateViewParts";
import {
  buildDisplaySegmentsForCandidate,
  cleanCandidatePreviewText,
  ensureBlankPlaceholders,
  formatQuestionTextForDisplay,
  getDisplayQuestionImageFromBlock,
  renderMathText,
  splitJudgeStemAndOptions,
  splitStemAndBlanks,
  splitStemAndOptions,
  type UILang,
} from "./displayUtils";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";

export const CANDIDATE_TEXT_STYLE: CSSProperties = {
  minWidth: 0,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  fontSize: orbitTypography.fontSize.md,
  lineHeight: orbitTypography.lineHeight.relaxed,
  color: orbitColors.text.primary,
};

function CandidateOptions({ items }: { items: Array<{ key: string; value: string }> }) {
  return (
    <div style={{ display: "grid", gap: orbitSpacing[1], marginTop: orbitSpacing[1] }}>
      {items.map((item, index) => (
        <div
          key={`${item.key}-${index}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: orbitSpacing[2],
            padding: `${orbitSpacing[1] + 2}px ${orbitSpacing[2]}px`,
            borderRadius: orbitRadius.sm,
            backgroundColor: orbitColors.bg.surfaceSubtle,
            border: `1px solid ${orbitColors.border.subtle}`,
            transition: "border-color 140ms ease",
          }}
        >
          <span
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 20,
              height: 20,
              padding: "0 4px",
              borderRadius: orbitRadius.sm,
              backgroundColor: orbitColors.bg.surfaceRaised,
              color: orbitColors.text.secondary,
              fontSize: orbitTypography.fontSize.xs,
              fontWeight: orbitTypography.fontWeight.bold,
              lineHeight: 1,
              marginTop: 1,
            }}
          >
            {item.key}
          </span>
          <span style={{ ...CANDIDATE_TEXT_STYLE, flex: 1, fontSize: orbitTypography.fontSize.sm }}>
            {renderMathText(formatQuestionTextForDisplay(item.value))}
          </span>
        </div>
      ))}
    </div>
  );
}

function CandidateStem({ text, lang }: { text: string; lang: UILang }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const copy = CANDIDATE_WORKSPACE_COPY[lang];

  if (text.length <= 600) {
    return (
      <div style={{ ...CANDIDATE_TEXT_STYLE, fontSize: orbitTypography.fontSize.md, fontWeight: orbitTypography.fontWeight.medium }}>
        {renderMathText(text || copy.noPreview)}
      </div>
    );
  }

  return (
    <div style={CANDIDATE_TEXT_STYLE}>
      <div id={contentId} style={{ fontSize: orbitTypography.fontSize.md, fontWeight: orbitTypography.fontWeight.medium }}>
        {expanded ? renderMathText(text) : `${text.slice(0, 180)}…`}
      </div>
      <OrbitButton
        size="sm"
        variant="ghost"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded(value => !value)}
        style={{
          marginTop: orbitSpacing[1],
          height: 26,
          paddingInline: orbitSpacing[1],
          fontSize: orbitTypography.fontSize.xs,
          color: orbitColors.brand.primary,
        }}
      >
        {expanded ? copy.hideQuestion : copy.showQuestion}
      </OrbitButton>
    </div>
  );
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
  const stem =
    block.questionTypeGuess === "fill_blank"
      ? ensureBlankPlaceholders(blanks.stem || normalized, blanks.blanks.length)
      : block.questionTypeGuess === "judge"
        ? judge.stem || normalized
        : choice.stem || normalized;

  const options =
    block.questionTypeGuess === "judge"
      ? judge.options
      : block.questionTypeGuess === "fill_blank"
        ? blanks.blanks.map((blank, index) => ({ key: copy.blank(index + 1), value: blank.hint }))
        : choice.options;

  const fallbackImage = segments.some(segment => segment.type === "image") ? "" : getDisplayQuestionImageFromBlock(block);
  const hasImage = !!fallbackImage || segments.some(segment => segment.type === "image");

  return (
    <div style={{ display: "grid", gap: orbitSpacing[2], ...CANDIDATE_TEXT_STYLE }}>
      {segments.length > 0 ? (
        <DisplaySegmentsView segments={segments} lang={lang} />
      ) : (
        <CandidateStem text={formatQuestionTextForDisplay(stem)} lang={lang} />
      )}
      {fallbackImage && <DisplaySegmentsView segments={[{ type: "image", url: fallbackImage }]} lang={lang} />}
      {options.length > 0 && <CandidateOptions items={options} />}
      {block.hasImage && !hasImage && (
        <p
          style={{
            margin: 0,
            padding: `${orbitSpacing[1]}px ${orbitSpacing[2]}px`,
            borderRadius: orbitRadius.sm,
            backgroundColor: orbitColors.bg.surfaceSubtle,
            border: `1px solid ${orbitColors.border.subtle}`,
            color: orbitColors.text.muted,
            fontSize: orbitTypography.fontSize.xs,
          }}
        >
          {copy.imageUnavailable}
        </p>
      )}
    </div>
  );
}
