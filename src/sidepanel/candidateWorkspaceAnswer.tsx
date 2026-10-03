import type { DetectedCandidate } from "@/shared/types";
import { isParseResultFillAuthoritative } from "@/shared/ai/parseResultAuthority";
import { OrbitButton } from "@/shared/ui/orbitPrimitives";
import { orbitColors, orbitRadius, orbitSpacing, orbitTypography } from "@/shared/ui/orbitTokens";
import { formatQuestionTextForDisplay, isStructuredAnswerExtractionFailed, renderMathText, resolveResultAnswerForDisplay, type UILang } from "./displayUtils";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";
import { CANDIDATE_TEXT_STYLE } from "./candidateWorkspaceContent";

export function CandidateAnswerSection({ candidate, lang, expanded, onToggleDetails, onFill, onRetryVision }: {
  candidate: DetectedCandidate; lang: UILang; expanded: boolean;
  onToggleDetails: () => void; onFill: () => void; onRetryVision: () => void;
}) {
  if (candidate.status !== "success" || !candidate.result) return null;
  const result = candidate.result;
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const extractionFailed = isStructuredAnswerExtractionFailed(result);
  const unavailable = extractionFailed || !isParseResultFillAuthoritative(result);
  const answer = resolveResultAnswerForDisplay(result, candidate.block.questionTypeGuess, candidate.block.previewText || result.recognizedText || "");
  const explanation = result.detailedExplanation || result.briefExplanation;
  return <section aria-label={copy.answer} style={{ display: "grid", gap: orbitSpacing[2], minWidth: 0 }}>
    <div style={{ padding: orbitSpacing[3], borderRadius: orbitRadius.sm, background: orbitColors.bg.surfaceRaised, ...CANDIDATE_TEXT_STYLE }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: orbitSpacing[1], fontSize: orbitTypography.fontSize.sm, color: orbitColors.text.secondary, marginBottom: orbitSpacing[1] }}>
        <span>{copy.answer}</span><span>{copy.confidence} {Math.round((result.confidence ?? 0) * 100)}%</span>
      </div>
      <strong>{renderMathText(formatQuestionTextForDisplay(answer))}</strong>
    </div>
    {unavailable && <p style={{ margin: 0, ...CANDIDATE_TEXT_STYLE, fontSize: orbitTypography.fontSize.sm, color: orbitColors.text.secondary }}>{extractionFailed ? copy.extractionFailed : copy.unverified}</p>}
    <div style={{ display: "flex", gap: orbitSpacing[2], flexWrap: "wrap" }}>
      <OrbitButton size="sm" variant="secondary" disabled={unavailable} onClick={onFill}>{unavailable ? copy.fillUnavailable : copy.fill}</OrbitButton>
      {explanation && <OrbitButton size="sm" variant="ghost" aria-expanded={expanded} onClick={onToggleDetails}>{expanded ? copy.hideDetails : copy.showDetails}</OrbitButton>}
      <OrbitButton size="sm" variant="ghost" onClick={onRetryVision}>{copy.retryVision}</OrbitButton>
    </div>
    {expanded && explanation && <div style={{ ...CANDIDATE_TEXT_STYLE, padding: orbitSpacing[2], borderTop: `1px solid ${orbitColors.border.subtle}` }}>{renderMathText(formatQuestionTextForDisplay(explanation))}</div>}
  </section>;
}
