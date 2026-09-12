import type { QuestionBlock } from "@/shared/types";
import { QuestionRevisionRegistry, instanceKeyFor, rootScopeOfAttachment, routeFingerprintForLocation } from "./questionRevisionRegistry";
import { rootAttachmentOf, TOP_ROOT_GENERATION, TOP_ROOT_KEY, type RuntimeRootAttachment } from "../roots/rootContext";
import type { RevisionAttemptIdentity } from "./questionRevisionTypes";
import { sharedRootRegistry } from "../roots/rootRegistry";

export const STALE_QUESTION_REVISION = "STALE_QUESTION_REVISION" as const;
export const STALE_ROOT_CONTEXT = "STALE_ROOT_CONTEXT" as const;

type ActiveAttempt = RevisionAttemptIdentity & { nativeQuestionId?: string; controller: AbortController; instanceKey: string };
const registry = new QuestionRevisionRegistry();
let activeAttempt: ActiveAttempt | null = null;

function rootScopeForBlock(block: QuestionBlock): { rootKey: string; rootGeneration: number } {
  const attachment = rootAttachmentOf(block);
  return { rootKey: attachment.rootKey ?? TOP_ROOT_KEY, rootGeneration: attachment.rootGeneration ?? TOP_ROOT_GENERATION };
}

function rootContextStale(rootKey: string, rootGeneration: number): boolean {
  if (rootKey === TOP_ROOT_KEY) return false;
  const context = sharedRootRegistry().get(rootKey);
  return !context || !context.connected || context.rootGeneration !== rootGeneration;
}

export function beginQuestionRevisionAttempt(block: QuestionBlock, controller: AbortController): RevisionAttemptIdentity {
  const route = registry.getRoute();
  const root = rootScopeForBlock(block);
  const identity: RevisionAttemptIdentity = {
    stableId: block.identity?.stableId ?? block.id,
    contentFingerprint: block.identity?.contentFingerprint ?? block.id,
    ...route,
    rootKey: root.rootKey,
    rootGeneration: root.rootGeneration,
  };
  activeAttempt = { ...identity, nativeQuestionId: block.identity?.nativeQuestionId, controller, instanceKey: instanceKeyFor(root.rootKey, identity.stableId) };
  return identity;
}

export function clearQuestionRevisionAttempt(controller?: AbortController): void {
  if (!controller || activeAttempt?.controller === controller) activeAttempt = null;
}

/** Mirrors the Phase 5 question-attempt finally cleanup without touching a newer question. */
export function clearQuestionRevisionAttemptForBlock(block: QuestionBlock): void {
  const root = rootScopeForBlock(block);
  const stableId = block.identity?.stableId ?? block.id;
  const contentFingerprint = block.identity?.contentFingerprint ?? block.id;
  if (activeAttempt?.stableId === stableId && activeAttempt.contentFingerprint === contentFingerprint && activeAttempt.rootKey === root.rootKey) {
    activeAttempt = null;
  }
}

export function abortQuestionRevisionAttempt(): void {
  activeAttempt?.controller.abort(STALE_QUESTION_REVISION);
}

/** Abort only when the active attempt belongs to the given root (removal/replacement). */
export function abortQuestionRevisionAttemptForRoot(rootKey: string): boolean {
  if (activeAttempt?.rootKey !== rootKey) return false;
  activeAttempt.controller.abort(STALE_QUESTION_REVISION);
  return true;
}

export function activeQuestionRevisionAttempt(): ActiveAttempt | null { return activeAttempt; }

export function hasQuestionRevisionAttempt(): boolean { return activeAttempt !== null; }

export function isQuestionRevisionCurrent(identity: RevisionAttemptIdentity): boolean {
  const route = registry.getRoute();
  const rootKey = identity.rootKey ?? TOP_ROOT_KEY;
  const rootGeneration = identity.rootGeneration ?? TOP_ROOT_GENERATION;
  return !activeAttempt?.controller.signal.aborted
    && activeAttempt?.stableId === identity.stableId
    && activeAttempt.contentFingerprint === identity.contentFingerprint
    && activeAttempt.rootKey === rootKey
    && activeAttempt.rootGeneration === rootGeneration
    && route.routeEpoch === identity.routeEpoch
    && route.routeFingerprint === identity.routeFingerprint
    && route.routeFingerprint === routeFingerprintForLocation()
    && !rootContextStale(rootKey, rootGeneration);
}

/** Final pre-mutation route/revision/root gate. Phase 5 still performs canonical DOM observation separately. */
export function isCurrentQuestionRevisionBlock(block: QuestionBlock): boolean {
  const root = rootScopeForBlock(block);
  const identity: RevisionAttemptIdentity = {
    stableId: block.identity?.stableId ?? block.id,
    contentFingerprint: block.identity?.contentFingerprint ?? block.id,
    rootKey: root.rootKey,
    rootGeneration: root.rootGeneration,
    ...registry.getRoute(),
  };
  return isQuestionRevisionCurrent(identity);
}

/** True when the given runtime attachment identifies the active attempt's instance. */
export function isActiveQuestionInstance(attachment: RuntimeRootAttachment | undefined, stableId: string): boolean {
  if (!activeAttempt) return false;
  const rootKey = attachment?.rootKey ?? TOP_ROOT_KEY;
  return activeAttempt.rootKey === rootKey && activeAttempt.stableId === stableId;
}

export function revisionRegistry(): QuestionRevisionRegistry { return registry; }

export { rootScopeOfAttachment };
