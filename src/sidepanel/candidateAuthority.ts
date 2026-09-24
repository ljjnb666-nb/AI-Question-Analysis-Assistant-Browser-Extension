import type { DetectedCandidate, QuestionBlock } from "@/shared/types";

export type CandidateAttemptLease = { key: string; token: symbol };

export function sameCandidateResultContext(
  left: Pick<DetectedCandidate, "block" | "origin">,
  right: Pick<DetectedCandidate, "block" | "origin">,
): boolean {
  const leftIdentity = left.block.identity;
  const rightIdentity = right.block.identity;
  return Boolean(
    left.origin?.tabId === right.origin?.tabId
      && left.origin?.url === right.origin?.url
      && left.block.source === "auto_dom"
      && right.block.source === "auto_dom"
      && leftIdentity?.stableId
      && leftIdentity.stableId === rightIdentity?.stableId
      && leftIdentity.contentFingerprint
      && leftIdentity.contentFingerprint === rightIdentity?.contentFingerprint
      && left.block.runtimeQuestionHandle
      && left.block.runtimeQuestionHandle === right.block.runtimeQuestionHandle,
  );
}

function attemptKey(candidate: Pick<DetectedCandidate, "block" | "origin">): string | null {
  const identity = candidate.block.identity;
  if (!candidate.origin?.tabId || !candidate.origin.url || !identity?.stableId || !identity.contentFingerprint || !candidate.block.runtimeQuestionHandle) {
    return null;
  }
  return JSON.stringify([
    candidate.origin.tabId,
    candidate.origin.url,
    identity.stableId,
    identity.contentFingerprint,
    candidate.block.runtimeQuestionHandle,
  ]);
}

/** Per-sidepanel ordering token: a late operation cannot replace a newer result for the same origin question. */
export function createCandidateAttemptRegistry() {
  const latest = new Map<string, symbol>();
  return {
    begin(candidate: Pick<DetectedCandidate, "block" | "origin">): CandidateAttemptLease | null {
      const key = attemptKey(candidate);
      if (!key) return null;
      const token = Symbol(key);
      latest.set(key, token);
      return { key, token };
    },
    isCurrent(lease: CandidateAttemptLease): boolean {
      return latest.get(lease.key) === lease.token;
    },
    invalidateAll(): void {
      latest.clear();
    },
  };
}

export type CandidateAttemptRegistry = ReturnType<typeof createCandidateAttemptRegistry>;

export function candidateMatchesBlockAndOrigin(
  candidate: Pick<DetectedCandidate, "block" | "origin">,
  block: QuestionBlock,
  origin: DetectedCandidate["origin"],
): boolean {
  return candidate.block.id === block.id
    && sameCandidateResultContext(candidate, { block, origin });
}
