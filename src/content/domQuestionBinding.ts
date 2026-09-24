import type { QuestionBlock, QuestionIdentity } from "@/shared/types";
import { attachQuestionIdentity } from "./questionIdentity";
import { collectMediaAssets, projectLegacyMedia } from "./media/mediaDiscovery";
import { attachRuntimeRoot, bindRuntimeQuestionHandle, rootAttachmentOf, topRootContext, type RootContext } from "./roots/rootContext";
import { getTraversalRoot } from "./roots/rootDom";
import { sharedRootRegistry } from "./roots/rootRegistry";

export type RuntimeBoundDomQuestionBlock = QuestionBlock & {
  identity: QuestionIdentity;
  runtimeQuestionHandle: string;
};

export type BindDomQuestionBlockOptions = {
  identityText?: string;
  nativeQuestionId?: string;
  rootContext?: RootContext;
  matchedCandidate?: QuestionBlock | null;
};

/**
 * Canonical construction path for every mutation-capable DOM question block.
 * The serialized block contains no DOM references; owner/root authority stays
 * in the content runtime and is represented across extension messaging only by
 * the opaque runtime question handle.
 */
export function bindDomQuestionBlockToOwner(
  draft: QuestionBlock,
  owner: Element,
  options: BindDomQuestionBlockOptions = {},
): RuntimeBoundDomQuestionBlock {
  if (draft.source !== "auto_dom") throw new Error("DOM runtime binding requires an auto_dom block");
  if (!owner.isConnected) throw new Error("DOM runtime binding requires a connected owner");

  const traversalRoot = getTraversalRoot(owner);
  const registry = sharedRootRegistry();
  const rootKey = registry.rootKeyOfRoot(traversalRoot);
  const discoveredContext = rootKey ? registry.get(rootKey) : undefined;
  const context = options.rootContext
    ?? discoveredContext
    ?? (traversalRoot === document ? topRootContext(document) : undefined);
  if (!context || context.root !== traversalRoot || context.ownerDocument !== owner.ownerDocument
    || !context.connected || !context.root.contains(owner)) {
    throw new Error("DOM runtime binding could not prove exact root ownership");
  }

  const withMedia = projectLegacyMedia(draft, collectMediaAssets(owner), owner);
  const identified = attachQuestionIdentity(withMedia, owner, {
    identityText: options.identityText ?? draft.identitySourceText ?? draft.previewText,
    nativeQuestionId: options.nativeQuestionId,
  });

  // A live site-adapter result may refine a canonical detector block. Reuse
  // that exact runtime identity only when both the DOM owner and semantic
  // identity still match; otherwise mint the block from this exact owner.
  const matched = options.matchedCandidate;
  const matchedRuntime = matched ? bindRuntimeQuestionHandle(matched) : null;
  const matchedAttachment = matched ? rootAttachmentOf(matched) : null;
  const reuseMatched = Boolean(
    matched
      && matchedRuntime?.owner === owner
      && matchedAttachment?.rootKey === context.rootKey
      && matchedAttachment.rootGeneration === context.rootGeneration
      && matched.identity?.stableId === identified.identity.stableId
      && matched.identity.contentFingerprint === identified.identity.contentFingerprint,
  );

  let canonical: QuestionBlock & { identity: QuestionIdentity } = identified;
  if (reuseMatched && matched?.identity) {
    canonical = {
      ...matched,
      identity: matched.identity,
      bbox: draft.bbox,
      previewText: draft.previewText,
      displaySegments: withMedia.displaySegments ?? matched.displaySegments,
      mediaAssets: withMedia.mediaAssets,
      primaryMediaAssetId: withMedia.primaryMediaAssetId,
      hasImage: withMedia.hasImage,
      questionImageUrl: withMedia.questionImageUrl,
      questionTypeGuess: draft.questionTypeGuess,
      confidence: draft.confidence,
      boundary: draft.boundary ?? matched.boundary,
      completeness: draft.completeness ?? matched.completeness,
    };
  }

  const bound = attachRuntimeRoot(canonical, {
    rootKey: context.rootKey,
    rootGeneration: context.rootGeneration,
    kind: context.kind,
  }, owner);
  if (!bound.runtimeQuestionHandle) throw new Error("DOM runtime binding could not create an opaque runtime handle");
  return bound as RuntimeBoundDomQuestionBlock;
}
