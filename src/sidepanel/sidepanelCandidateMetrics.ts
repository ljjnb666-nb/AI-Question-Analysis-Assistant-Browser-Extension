import type { DetectedCandidate } from "@/shared/types";

export type CandidateViewFilter = "all" | "risky" | "done";

export function computeCandidateMetrics(
  candidates: DetectedCandidate[],
  candidateViewFilter: CandidateViewFilter,
  isRiskyCandidate: (candidate: DetectedCandidate) => boolean,
) {
  const selectedCount = candidates.filter((c) => c.selected).length;
  const selectedSolvedCount = candidates.filter((c) => c.selected && c.status === "success" && c.result).length;
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
