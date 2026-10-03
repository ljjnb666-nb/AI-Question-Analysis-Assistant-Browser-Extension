import { OrbitButton, OrbitSurface } from "@/shared/ui/orbitPrimitives";
import { orbitColors, orbitSpacing, orbitTypography } from "@/shared/ui/orbitTokens";
import type { DetectionPhase } from "@/shared/types";
import type { UILang } from "./displayUtils";
import type { CandidateViewFilter } from "./sidepanelCandidateMetrics";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";

export function CandidateSummary({ lang, counts }: { lang: UILang; counts: { detected: number; selected: number; solved: number; risky: number } }) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  return <dl aria-label={copy.summary} style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: orbitSpacing[1], paddingBlock: orbitSpacing[2] }}>
    {(["detected", "selected", "solved", "risky"] as const).map(key => <div key={key} style={{ padding: orbitSpacing[1], minWidth: 0 }}>
      <dt style={{ fontSize: orbitTypography.fontSize.sm, color: orbitColors.text.secondary, overflowWrap: "anywhere" }}>{copy[key]}</dt>
      <dd style={{ margin: 0, fontSize: orbitTypography.fontSize.lg, fontWeight: orbitTypography.fontWeight.semibold }}>{counts[key]}</dd>
    </div>)}
  </dl>;
}

export type CandidateAction = { label: string; onAction: () => void; disabled?: boolean; primary?: boolean; danger?: boolean };
export function CandidateActionBar({ lang, actions }: { lang: UILang; actions: CandidateAction[] }) {
  return <div role="group" aria-label={CANDIDATE_WORKSPACE_COPY[lang].actions} style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: orbitSpacing[2] }}>
    {actions.map(action => <OrbitButton key={action.label} size="sm" variant={action.danger ? "danger" : action.primary ? "primary" : "secondary"}
      disabled={action.disabled} onClick={action.onAction} style={{ minWidth: 0, whiteSpace: "normal", height: "auto", minHeight: orbitSpacing[8], overflowWrap: "anywhere" }}>{action.label}</OrbitButton>)}
  </div>;
}

export function CandidateReviewToolbar({ lang, filter, onFilter, onClear, selectedCount }: {
  lang: UILang; filter: CandidateViewFilter; onFilter: (filter: CandidateViewFilter) => void; onClear: () => void; selectedCount: number;
}) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const views: Array<[CandidateViewFilter, string]> = [["all", copy.all], ["selected", copy.selected], ["unsolved", copy.unsolved], ["done", copy.solved], ["risky", copy.review]];
  return <div style={{ display: "grid", gap: orbitSpacing[1], borderBlock: `1px solid ${orbitColors.border.subtle}`, paddingBlock: orbitSpacing[2] }}>
    <div role="group" aria-label={copy.filters} style={{ display: "flex", flexWrap: "wrap", gap: orbitSpacing[1] }}>
      {views.map(([key, label]) => <OrbitButton key={key} variant={filter === key ? "secondary" : "ghost"} size="sm" aria-pressed={filter === key} onClick={() => onFilter(key)}>{label}</OrbitButton>)}
    </div>
    <OrbitButton size="sm" variant="ghost" disabled={!selectedCount} onClick={onClear} style={{ justifySelf: "end" }}>{copy.clear}</OrbitButton>
  </div>;
}

export function CandidateEmptyState({ lang, phase, filteredEmpty = false }: { lang: UILang; phase: DetectionPhase; filteredEmpty?: boolean }) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const message = filteredEmpty ? copy.filterEmpty : phase === "detecting" ? copy.detectingEmpty : phase === "completed" ? copy.completedEmpty : copy.notStarted;
  return <OrbitSurface role="status" style={{ padding: orbitSpacing[4], fontSize: orbitTypography.fontSize.md, lineHeight: orbitTypography.lineHeight.relaxed, color: orbitColors.text.secondary }}>{message}</OrbitSurface>;
}
