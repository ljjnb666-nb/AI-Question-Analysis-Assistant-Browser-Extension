import type { CandidateOrigin, DetectedCandidate, QuestionBlock } from "@/shared/types";

/** Ordinal/index is never evidence. Conflicting IDs/semantic identity fail closed. */
export function findActiveCandidateId(candidates: DetectedCandidate[], origin: CandidateOrigin, currentQuestionId?: string, currentBlock?: QuestionBlock): string | null {
  const identity = currentBlock?.identity;
  if (!identity?.stableId || !identity.contentFingerprint || !currentQuestionId || !currentBlock
    || currentQuestionId !== currentBlock.id) return null;
  const matches = candidates.filter((candidate) => candidate.origin?.tabId === origin.tabId && candidate.origin.url === origin.url
    && candidate.block.identity?.stableId === identity.stableId && candidate.block.identity.contentFingerprint === identity.contentFingerprint);
  return matches.length === 1 && matches[0]?.block.id === currentQuestionId ? matches[0].block.id : null;
}
