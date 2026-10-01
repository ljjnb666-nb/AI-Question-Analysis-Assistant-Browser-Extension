import type { DetectedCandidate } from "@/shared/types";
import { isParseResultFillAuthoritative } from "@/shared/ai/parseResultAuthority";
import { isStructuredAnswerExtractionFailed } from "./displayUtils";

export type CandidateViewFilter = "all" | "risky" | "done";

/**
 * UI-00B PART D: the single fill-readiness predicate shared by the UI count
 * and Batch Fill. A candidate may only be counted (or filled) when its result
 * proves provider provenance (UI-00A) and carries a fillable structured
 * answer — exactly the conditions under which the per-candidate Fill button
 * is enabled.
 */
export function isCandidateFillReady(candidate: DetectedCandidate): boolean {
  return Boolean(
    candidate.selected
    && candidate.status === "success"
    && candidate.result
    && isParseResultFillAuthoritative(candidate.result)
    && !isStructuredAnswerExtractionFailed(candidate.result),
  );
}

export function computeCandidateMetrics(
  candidates: DetectedCandidate[],
  candidateViewFilter: CandidateViewFilter,
  isRiskyCandidate: (candidate: DetectedCandidate) => boolean,
) {
  const selectedCount = candidates.filter((c) => c.selected).length;
  // UI-00B-INV-07: this count is fill authority, not "has any result" —
  // mock, legacy-unproven, and extraction-failed results never inflate it.
  const selectedSolvedCount = candidates.filter(isCandidateFillReady).length;
  const riskyCount = candidates.filter(isRiskyCandidate).length;
  const doneCount = candidates.filter((cand) => cand.status === "success").length;
  const filteredCandidates = candidates.filter((cand) => {
    if (candidateViewFilter === "risky") return isRiskyCandidate(cand);
    if (candidateViewFilter === "done") return cand.status === "success";
    return true;
  });

  return {
    doneCount,
    filteredCandidates,
    riskyCount,
    selectedCount,
    selectedSolvedCount,
  };
}
