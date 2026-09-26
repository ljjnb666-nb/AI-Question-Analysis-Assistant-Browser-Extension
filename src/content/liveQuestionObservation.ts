import type { QuestionBlock } from "@/shared/types";
import { collectMediaAssets, projectLegacyMedia } from "./media/mediaDiscovery";
import { attachQuestionIdentity, extractOrdinalHint } from "./questionIdentity";
import { extractStructuredQuestionText } from "./detector/domStructuredText";
import { normalizeText } from "./detector/domText";
import { resolveFillRootContext, sharedRootRegistry } from "./roots/rootRegistry";

const QUESTION_OWNER_SELECTOR = ".question-item,.questionBox,.base-question-component,[data-question-id],[data-questionid],[data-problem-id],[data-problemid],[data-item-id]";

/**
 * A deliberately one-shot reconstruction of the canonical Phase 1-4 identity.
 * It is used only immediately before a mutation; it does not watch or heal DOM.
 */
export function observeLiveQuestion(block: QuestionBlock, owner: Element) {
  // The binding-time source is serialized with the block and never re-inferred
  // from the current DOM shape. Legacy callers that mint identity here get a
  // deterministic structured source once; pre-identified auto_dom blocks with
  // no provenance remain unauthorized for mutation.
  const identityObservationSource = block.identityObservationSource
    ?? (block.identity ? undefined : "structured");
  const text = identityObservationSource === "rendered"
    ? normalizeText(String((owner as HTMLElement).innerText || owner.textContent || ""))
    : normalizeText(extractStructuredQuestionText(owner));
  const withMedia = projectLegacyMedia({ ...block, identityObservationSource, previewText: text }, collectMediaAssets(owner), owner);
  return attachQuestionIdentity(withMedia, owner, { identityText: text });
}

/** Resolve a single semantic question subtree; broad multi-question wrappers fail closed. */
export function resolveCanonicalQuestionOwner(block: QuestionBlock, suppliedOwner: Element): Element | null {
  if (suppliedOwner.matches(QUESTION_OWNER_SELECTOR)) return suppliedOwner;
  const nested = Array.from(suppliedOwner.querySelectorAll(QUESTION_OWNER_SELECTOR));
  // Keep only outermost semantic owners, so a question's internal component does
  // not make its otherwise unambiguous owner appear broad.
  const candidates = nested.filter((candidate) => !nested.some((other) => other !== candidate && other.contains(candidate)));
  if (!candidates.length) return suppliedOwner;
  if (candidates.length === 1) return candidates[0];

  const expectedId = block.identity?.stableId;
  if (expectedId) {
    const byIdentity = candidates.filter((candidate) => observeLiveQuestion(block, candidate).identity.stableId === expectedId);
    if (byIdentity.length === 1) return byIdentity[0];
  }
  const ordinal = extractOrdinalHint(block.previewText);
  if (ordinal !== undefined) {
    const byOrdinal = candidates.filter((candidate) => extractOrdinalHint(String((candidate as HTMLElement).innerText || candidate.textContent || "")) === ordinal);
    if (byOrdinal.length === 1) return byOrdinal[0];
  }
  return null;
}

/** Validate a serialized result against its originating content runtime and live owner. */
export function isCurrentRuntimeQuestionBlock(block: QuestionBlock): boolean {
  if (block.source !== "auto_dom" || !block.runtimeQuestionHandle || !block.identityObservationSource || !block.identity?.stableId || !block.identity.contentFingerprint) return false;
  const context = resolveFillRootContext(sharedRootRegistry(), block);
  if (!context.ok || !context.owner) return false;
  const live = observeLiveQuestion(block, context.owner).identity;
  return live.stableId === block.identity.stableId
    && live.contentFingerprint === block.identity.contentFingerprint;
}
