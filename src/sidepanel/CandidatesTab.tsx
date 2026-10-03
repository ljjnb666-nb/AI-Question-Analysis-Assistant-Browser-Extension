import React from "react";
import type { CandidateOrigin, DetectedCandidate, DetectionPhase } from "@/shared/types";
import type { AutoSolveProgressState, ScanProgressState } from "./sidepanelStateSync";
import type { CandidateViewFilter } from "./sidepanelCandidateMetrics";
import type { UILang } from "./displayUtils";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import { CandidateWorkspaceCard } from "./CandidateWorkspaceCard";
import { CandidateSummary, CandidateActionBar, CandidateReviewToolbar, CandidateEmptyState, type CandidateAction } from "./candidateWorkspaceSections";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";
import { findActiveCandidateId } from "./activeCandidateIdentity";
import { orbitSpacing } from "@/shared/ui/orbitTokens";
type CandidateScanProgress = ScanProgressState;
export const CandidatesTab: React.FC<{
  autoSolveProgress: AutoSolveProgressState;
  detectionPhase?: DetectionPhase;
  workspaceOrigin?: CandidateOrigin;
  candidateViewFilter: CandidateViewFilter;
  candidates: DetectedCandidate[];
  doneCount: number;
  expandedIds: Record<string, boolean>;
  fillFeedback: UserFeedback | null;
  filteredCandidates: DetectedCandidate[];
  isAutoSolving: boolean;
  isBatchFilling: boolean;
  isBatchParsing: boolean;
  isDetecting: boolean;
  isFullPageScan: boolean;
  isRetryingRisky: boolean;
  lang: UILang;
  riskyCount: number;
  scanProgress: CandidateScanProgress;
  selectedCount: number;
  selectedSolvedCount: number;
  onBatchFill: () => void;
  onBatchParse: () => void;
  onCancelFullPage: () => void;
  onCandidateFilterChange: (filter: CandidateViewFilter) => void;
  onClearSelection: () => void;
  onDetect: () => void;
  onFillCandidate: (candidate: DetectedCandidate) => void;
  onFlashCandidate: (blockId: string) => void;
  onFullPageDetect: () => void;
  onRetryRisky: () => void;
  onRetryVision: (candidate: DetectedCandidate) => void;
  onSelectAll: () => void;
  onSelectRisky: () => void;
  onStartAutoSolve: () => void;
  onStopAutoSolve: () => void;
  onToggleCandidate: (blockId: string) => void;
  onToggleDetails: (blockId: string) => void;
}> = (props) => {
  const { lang, candidates, filteredCandidates, isAutoSolving, isBatchFilling, isBatchParsing, isDetecting, isFullPageScan, isRetryingRisky } = props;
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const busy = isAutoSolving || isBatchFilling || isBatchParsing || isDetecting || isFullPageScan || isRetryingRisky;
  const actions: CandidateAction[] = [
    { label: copy.currentView, onAction: props.onDetect, disabled: busy },
    { label: isFullPageScan ? copy.cancelScan : copy.fullPage, onAction: isFullPageScan ? props.onCancelFullPage : props.onFullPageDetect, disabled: busy && !isFullPageScan },
    { label: isAutoSolving ? copy.stop : copy.solveFill, onAction: isAutoSolving ? props.onStopAutoSolve : props.onStartAutoSolve, disabled: busy && !isAutoSolving, primary: !isAutoSolving, danger: isAutoSolving },
    { label: copy.solveSelected, onAction: props.onBatchParse, disabled: busy || !props.selectedCount },
    { label: copy.fillSelected, onAction: props.onBatchFill, disabled: busy || !props.selectedSolvedCount },
  ];
  if (props.riskyCount) {
    actions.push({ label: copy.selectReview, onAction: props.onSelectRisky, disabled: busy });
    actions.push({ label: copy.retryReview, onAction: props.onRetryRisky, disabled: busy });
  }
  const activeId = isAutoSolving && props.workspaceOrigin
    ? findActiveCandidateId(candidates, props.workspaceOrigin, props.autoSolveProgress?.currentQuestionId, props.autoSolveProgress?.currentBlock) : null;
  const indexById = new Map(candidates.map((candidate, index) => [candidate.block.id, index + 1]));
  return <div data-candidate-workspace style={{ padding: `0 ${orbitSpacing[3]}px ${orbitSpacing[4]}px`, display: "grid", gap: orbitSpacing[3], minWidth: 0 }}>
    <CandidateSummary lang={lang} counts={{ detected: candidates.length, selected: props.selectedCount, solved: props.doneCount, risky: props.riskyCount }} />
    <CandidateActionBar lang={lang} actions={actions} />
    <CandidateReviewToolbar lang={lang} filter={props.candidateViewFilter} onFilter={props.onCandidateFilterChange} onClear={props.onClearSelection} selectedCount={props.selectedCount} />
    {filteredCandidates.length === 0 && <CandidateEmptyState lang={lang} phase={props.detectionPhase ?? (isDetecting || isFullPageScan ? "detecting" : "never_started")} filteredEmpty={candidates.length > 0} />}
    <div style={{ display: "grid", gap: orbitSpacing[3], minWidth: 0 }}>
      {filteredCandidates.map(candidate => <CandidateWorkspaceCard key={candidate.block.id} index={indexById.get(candidate.block.id)!} cand={candidate}
        isExpanded={!!props.expandedIds[candidate.block.id]} active={candidate.block.id === activeId} lang={lang}
        onToggle={() => props.onToggleCandidate(candidate.block.id)} onFlash={() => props.onFlashCandidate(candidate.block.id)}
        onToggleDetails={() => props.onToggleDetails(candidate.block.id)} onFill={() => props.onFillCandidate(candidate)} onRetryVision={() => props.onRetryVision(candidate)} />)}
    </div>
  </div>;
};