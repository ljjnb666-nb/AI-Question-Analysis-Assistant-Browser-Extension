import type { DetectedCandidate } from "@/shared/types";
import { OrbitBadge, OrbitButton, OrbitSurface } from "@/shared/ui/orbitPrimitives";
import { useFocusVisible } from "@/shared/ui/orbitFocus";
import { orbitColors, orbitFocus, orbitSpacing, orbitTypography } from "@/shared/ui/orbitTokens";
import { CandidateQuestionContent, CANDIDATE_TEXT_STYLE } from "./candidateWorkspaceContent";
import { CandidateAnswerSection } from "./candidateWorkspaceAnswer";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";
import { deriveCandidatePresentation } from "./candidatePresentation";
import type { UILang } from "./displayUtils";

function CandidateSelection({ checked, index, lang, onToggle }: { checked: boolean; index: number; lang: UILang; onToggle: () => void }) {
  const focus = useFocusVisible();
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  return <label style={{ display: "flex", alignItems: "center", gap: orbitSpacing[2], cursor: "pointer", minHeight: orbitSpacing[8] }}>
    <input type="checkbox" checked={checked} aria-label={copy.select(index)} onChange={onToggle} onFocus={focus.onFocus} onBlur={focus.onBlur}
      style={{ margin: 0, width: orbitSpacing[4], height: orbitSpacing[4], accentColor: orbitColors.brand.primary, outline: focus.isFocusVisible ? orbitFocus.outline : "none", outlineOffset: orbitFocus.outlineOffset }} />
    <strong style={{ fontSize: orbitTypography.fontSize.md }}>{copy.question(index)}</strong>
  </label>;
}

export function CandidateWorkspaceCard({ index, cand, isExpanded, active = false, onToggle, onFlash, onToggleDetails, onFill, onRetryVision, lang }: {
  index: number; cand: DetectedCandidate; isExpanded: boolean; active?: boolean; lang: UILang;
  onToggle: () => void; onFlash: () => void; onToggleDetails: () => void; onFill: () => void; onRetryVision: () => void;
}) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const presentation = deriveCandidatePresentation(cand, lang, active);
  return <OrbitSurface role="article" aria-label={copy.question(index)} data-candidate-id={cand.block.id} data-candidate-status={presentation.status} data-active={active || undefined}
    style={{ minWidth: 0, padding: orbitSpacing[3], display: "grid", gap: orbitSpacing[3], borderColor: active ? orbitColors.ai.border : cand.selected ? orbitColors.brand.border : orbitColors.border.subtle, background: cand.selected ? orbitColors.brand.subtle : orbitColors.bg.surface }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: orbitSpacing[2] }}>
      <CandidateSelection checked={cand.selected} index={index} lang={lang} onToggle={onToggle} />
      <OrbitBadge variant={presentation.tone}>{presentation.label}</OrbitBadge>
    </div>
    <CandidateQuestionContent block={cand.block} lang={lang} />
    {presentation.reasons.length > 0 && <div style={{ ...CANDIDATE_TEXT_STYLE, color: orbitColors.text.secondary, fontSize: orbitTypography.fontSize.sm }}>
      {presentation.reasons.map(reason => <p key={reason} style={{ margin: 0 }}>{reason}</p>)}
    </div>}
    {presentation.errorFeedback && <div data-error-tone={presentation.errorFeedback.tone} style={{ ...CANDIDATE_TEXT_STYLE, fontSize: orbitTypography.fontSize.sm }}>{presentation.errorFeedback.message}</div>}
    <CandidateAnswerSection candidate={cand} lang={lang} expanded={isExpanded} onToggleDetails={onToggleDetails} onFill={onFill} onRetryVision={onRetryVision} />
    <div style={{ display: "flex", flexWrap: "wrap", gap: orbitSpacing[2] }}>
      <OrbitButton variant="ghost" size="sm" onClick={onFlash}>{copy.locate}</OrbitButton>
      {cand.status === "error" && <OrbitButton variant="secondary" size="sm" onClick={onRetryVision}>{copy.retryVision}</OrbitButton>}
    </div>
  </OrbitSurface>;
}
