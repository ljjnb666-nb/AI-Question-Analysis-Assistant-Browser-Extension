import type { DetectedCandidate } from "@/shared/types";

export const toggleCandidateSelection = (candidates: DetectedCandidate[], id: string) =>
  candidates.map((candidate) =>
    candidate.block.id === id ? { ...candidate, selected: !candidate.selected } : candidate,
  );

export const clearCandidateSelection = (candidates: DetectedCandidate[]) =>
  candidates.map((candidate) => ({ ...candidate, selected: false }));

export const selectAllCandidates = (candidates: DetectedCandidate[]) =>
  candidates.map((candidate) => ({ ...candidate, selected: true }));
