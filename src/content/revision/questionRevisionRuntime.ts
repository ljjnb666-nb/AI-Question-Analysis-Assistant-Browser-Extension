import type { QuestionBlock } from "@/shared/types";
import { QuestionRevisionRegistry, routeFingerprintForLocation } from "./questionRevisionRegistry";
import type { RevisionAttemptIdentity } from "./questionRevisionTypes";

export const STALE_QUESTION_REVISION = "STALE_QUESTION_REVISION" as const;

type ActiveAttempt = RevisionAttemptIdentity & { nativeQuestionId?: string; controller: AbortController };
const registry = new QuestionRevisionRegistry();
let activeAttempt: ActiveAttempt | null = null;

export function beginQuestionRevisionAttempt(block: QuestionBlock, controller: AbortController): RevisionAttemptIdentity {
  const route = registry.getRoute();
  const identity: RevisionAttemptIdentity = {
    stableId: block.identity?.stableId ?? block.id,
    contentFingerprint: block.identity?.contentFingerprint ?? block.id,
    ...route,
  };
  activeAttempt = { ...identity, nativeQuestionId: block.identity?.nativeQuestionId, controller };
  return identity;
}

export function clearQuestionRevisionAttempt(controller?: AbortController): void {
  if (!controller || activeAttempt?.controller === controller) activeAttempt = null;
}

/** Mirrors the Phase 5 question-attempt finally cleanup without touching a newer question. */
export function clearQuestionRevisionAttemptForBlock(block: QuestionBlock): void {
  const stableId = block.identity?.stableId ?? block.id;
  const contentFingerprint = block.identity?.contentFingerprint ?? block.id;
  if (activeAttempt?.stableId === stableId && activeAttempt.contentFingerprint === contentFingerprint) {
    activeAttempt = null;
  }
}

export function abortQuestionRevisionAttempt(): void {
  activeAttempt?.controller.abort(STALE_QUESTION_REVISION);
}

export function activeQuestionRevisionAttempt(): ActiveAttempt | null { return activeAttempt; }

export function hasQuestionRevisionAttempt(): boolean { return activeAttempt !== null; }

export function isQuestionRevisionCurrent(identity: RevisionAttemptIdentity): boolean {
  const route = registry.getRoute();
  return !activeAttempt?.controller.signal.aborted
    && activeAttempt?.stableId === identity.stableId
    && activeAttempt.contentFingerprint === identity.contentFingerprint
    && route.routeEpoch === identity.routeEpoch
    && route.routeFingerprint === identity.routeFingerprint
    && route.routeFingerprint === routeFingerprintForLocation();
}

/** Final pre-mutation route/revision gate. Phase 5 still performs canonical DOM observation separately. */
export function isCurrentQuestionRevisionBlock(block: QuestionBlock): boolean {
  const route = registry.getRoute();
  const stableId = block.identity?.stableId ?? block.id;
  const contentFingerprint = block.identity?.contentFingerprint ?? block.id;
  return !activeAttempt?.controller.signal.aborted
    && activeAttempt?.stableId === stableId
    && activeAttempt.contentFingerprint === contentFingerprint
    && activeAttempt.routeEpoch === route.routeEpoch
    && activeAttempt.routeFingerprint === route.routeFingerprint
    && route.routeFingerprint === routeFingerprintForLocation();
}

export function revisionRegistry(): QuestionRevisionRegistry { return registry; }
