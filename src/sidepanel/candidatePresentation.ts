import type { DetectedCandidate } from "@/shared/types";
import type { OrbitBadgeProps } from "@/shared/ui/orbitPrimitives";
import { mapKnownCodeFeedback, mapUserFacingError } from "@/shared/ui/userFeedback";
import { isRiskyCandidate, shouldRetryWithVision } from "./batchParseHeuristics";
import { CANDIDATE_WORKSPACE_COPY } from "./candidateWorkspaceCopy";
import type { UILang } from "./displayUtils";

export type CandidateDisplayStatus = "detected" | "solving" | "solved" | "review" | "failed" | "stale";
const STATUS_TONE: Record<CandidateDisplayStatus, NonNullable<OrbitBadgeProps["variant"]>> = {
  detected: "neutral", solving: "ai", solved: "success", review: "warning", failed: "error", stale: "warning",
};
const STALE_CODES = new Set(["STALE_QUESTION_REVISION", "STALE_ROOT_CONTEXT", "STALE_ACTION_PLAN"]);

export function deriveCandidatePresentation(candidate: DetectedCandidate, lang: UILang, active = false) {
  const copy = CANDIDATE_WORKSPACE_COPY[lang];
  const stale = STALE_CODES.has(candidate.error ?? "");
  const risky = isRiskyCandidate(candidate);
  const status: CandidateDisplayStatus = stale ? "stale" : candidate.status === "error" ? "failed"
    : active || candidate.status === "loading" ? "solving" : risky ? "review"
      : candidate.status === "success" && candidate.result ? "solved" : "detected";
  const reasons: string[] = [];
  if (risky && candidate.status !== "error" && candidate.result) {
    if ((candidate.result.confidence ?? 0) < 0.72) reasons.push(copy.lowConfidence);
    // This predicate is the existing risk contract. Its remaining branch is
    // the existing incomplete-hint pattern, not an invented model explanation.
    if (shouldRetryWithVision({ ...candidate.result, confidence: 1 })) reasons.push(copy.incomplete);
  }
  const errorFeedback = candidate.status === "error"
    ? (mapKnownCodeFeedback(candidate.error ?? "", lang) ?? mapUserFacingError(candidate.error ?? "", lang)) : null;
  return { status, tone: STATUS_TONE[status], label: copy.status[status], risky, reasons, errorFeedback };
}
