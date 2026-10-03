import React from "react";
import type { DetectedCandidate } from "@/shared/types";
import { isParseResultFillAuthoritative } from "@/shared/ai/parseResultAuthority";
import { OrbitButton } from "@/shared/ui/orbitPrimitives";
import { orbitColors, orbitRadius, orbitSpacing, orbitTypography } from "@/shared/ui/orbitTokens";
import {
  formatQuestionTextForDisplay,
  isStructuredAnswerExtractionFailed,
  renderMathText,
  resolveResultAnswerForDisplay,
  type UILang,
} from "./displayUtils";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";
import { CANDIDATE_TEXT_STYLE } from "./candidateWorkspaceContent";

export function CandidateAnswerSection({
  candidate,
  lang,
  expanded,
  onToggleDetails,
  onFill,
  onRetryVision,
}: {
  candidate: DetectedCandidate;
  lang: UILang;
  expanded: boolean;
  onToggleDetails: () => void;
  onFill: () => void;
  onRetryVision: () => void;
}) {
  if (candidate.status !== "success" || !candidate.result) return null;
  const result = candidate.result;
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const extractionFailed = isStructuredAnswerExtractionFailed(result);
  const unavailable = extractionFailed || !isParseResultFillAuthoritative(result);
  const answer = resolveResultAnswerForDisplay(
    result,
    candidate.block.questionTypeGuess,
    candidate.block.previewText || result.recognizedText || "",
  );
  const explanation = result.detailedExplanation || result.briefExplanation;
  const confidencePercent = Math.round((result.confidence ?? 0) * 100);
  const isHighConfidence = (result.confidence ?? 0) >= 0.72;

  return (
    <section
      aria-label={copy.answer}
      style={{
        display: "grid",
        gap: orbitSpacing[2],
        minWidth: 0,
        borderRadius: orbitRadius.md,
        backgroundColor: orbitColors.bg.surfaceRaised,
        border: `1px solid ${orbitColors.border.default}`,
        padding: orbitSpacing[3],
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      }}
    >
      {/* Answer Header: Tag & Confidence */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: orbitSpacing[1],
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 8px",
            borderRadius: orbitRadius.pill,
            backgroundColor: orbitColors.semantic.successSurface,
            color: orbitColors.semantic.success,
            fontSize: orbitTypography.fontSize.xs,
            fontWeight: orbitTypography.fontWeight.bold,
            letterSpacing: 0.3,
          }}
        >
          {copy.answer}
        </span>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: orbitTypography.fontSize.xs,
            color: isHighConfidence ? orbitColors.text.secondary : orbitColors.semantic.warning,
            fontWeight: orbitTypography.fontWeight.medium,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: isHighConfidence ? orbitColors.semantic.success : orbitColors.semantic.warning,
            }}
          />
          {copy.confidence} {confidencePercent}%
        </span>
      </div>

      {/* Answer Body Display */}
      <div
        style={{
          ...CANDIDATE_TEXT_STYLE,
          fontSize: orbitTypography.fontSize.lg,
          fontWeight: orbitTypography.fontWeight.bold,
          color: orbitColors.text.primary,
          paddingBlock: 2,
        }}
      >
        {renderMathText(formatQuestionTextForDisplay(answer))}
      </div>

      {/* Unavailable Warnings */}
      {unavailable && (
        <p
          style={{
            margin: 0,
            ...CANDIDATE_TEXT_STYLE,
            fontSize: orbitTypography.fontSize.xs,
            color: orbitColors.semantic.warning,
            backgroundColor: orbitColors.semantic.warningSurface,
            padding: `${orbitSpacing[1]}px ${orbitSpacing[2]}px`,
            borderRadius: orbitRadius.sm,
            border: `1px solid ${orbitColors.semantic.warningBorder}`,
          }}
        >
          {extractionFailed ? copy.extractionFailed : copy.unverified}
        </p>
      )}

      {/* Action Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: orbitSpacing[2],
          paddingTop: orbitSpacing[1],
          borderTop: `1px solid ${orbitColors.border.subtle}`,
        }}
      >
        <OrbitButton
          size="sm"
          variant={unavailable ? "secondary" : "primary"}
          disabled={unavailable}
          onClick={onFill}
          style={{
            height: 28,
            paddingInline: orbitSpacing[3],
            fontSize: orbitTypography.fontSize.xs,
          }}
        >
          {unavailable ? copy.fillUnavailable : copy.fill}
        </OrbitButton>

        {explanation && (
          <OrbitButton
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            onClick={onToggleDetails}
            style={{
              height: 28,
              paddingInline: orbitSpacing[2],
              fontSize: orbitTypography.fontSize.xs,
            }}
          >
            {expanded ? copy.hideDetails : copy.showDetails}
          </OrbitButton>
        )}

        <OrbitButton
          size="sm"
          variant="ghost"
          onClick={onRetryVision}
          style={{
            height: 28,
            paddingInline: orbitSpacing[2],
            fontSize: orbitTypography.fontSize.xs,
            color: orbitColors.text.muted,
          }}
        >
          {copy.retryVision}
        </OrbitButton>
      </div>

      {/* Explanation Details Disclosure */}
      {expanded && explanation && (
        <div
          style={{
            ...CANDIDATE_TEXT_STYLE,
            fontSize: orbitTypography.fontSize.sm,
            color: orbitColors.text.secondary,
            padding: `${orbitSpacing[2]}px ${orbitSpacing[3]}px`,
            backgroundColor: orbitColors.bg.surfaceSubtle,
            borderRadius: orbitRadius.sm,
            border: `1px solid ${orbitColors.border.subtle}`,
            lineHeight: orbitTypography.lineHeight.relaxed,
          }}
        >
          {renderMathText(formatQuestionTextForDisplay(explanation))}
        </div>
      )}
    </section>
  );
}
