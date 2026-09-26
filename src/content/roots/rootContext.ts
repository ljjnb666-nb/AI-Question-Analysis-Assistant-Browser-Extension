import type { QuestionBlock } from "@/shared/types";

/**
 * Phase 7 accessible-root model. Runtime-only: nothing here is persisted, and
 * no root context ever contains URLs. Root keys are process-local counters.
 *
 * A root is one traversable DOM subtree the question engine may inspect:
 * - the top document,
 * - a same-origin iframe document (including nested frames),
 * - an open ShadowRoot (shadowRoot !== null; closed roots are never visible
 *   to script and stay out of scope).
 */

export type AccessibleRootKind = "top-document" | "same-origin-frame" | "open-shadow-root";

export type TraversableRoot = Document | ShadowRoot;

export type RootContext = {
  rootKey: string;
  kind: AccessibleRootKind;
  root: TraversableRoot;
  ownerDocument: Document;
  ownerWindow: Window;
  parentRootKey?: string;
  frameElement?: HTMLIFrameElement;
  shadowHost?: Element;
  rootGeneration: number;
  connected: boolean;
};

export type RuntimeRootAttachment = {
  rootKey: string;
  rootGeneration: number;
  kind: AccessibleRootKind;
};

export type RuntimeQuestionHandleRecord = {
  attachment: RuntimeRootAttachment;
  stableId: string;
  contentFingerprint: string;
  owner: Element;
};

export type SealedRuntimeQuestionHandleRecord = Omit<RuntimeQuestionHandleRecord, "owner"> & { owner: Element | undefined };

type RuntimeOwnerReference = { deref: () => Element | undefined };
type WeakRefConstructor = new (target: Element) => RuntimeOwnerReference;
type StoredRuntimeQuestionHandle = Omit<RuntimeQuestionHandleRecord, "owner"> & { owner: RuntimeOwnerReference };

/** Runtime-only block attachment; Symbol keys survive object spread but are dropped by JSON. */
export const RUNTIME_ROOT = Symbol("qsRuntimeRoot");
export const RUNTIME_OWNER = Symbol("qsRuntimeOwner");

const MAX_RUNTIME_QUESTION_HANDLES = 512;
const runtimeQuestionHandles = new Map<string, StoredRuntimeQuestionHandle>();
const WeakRefApi = (globalThis as typeof globalThis & { WeakRef?: WeakRefConstructor }).WeakRef;

export const TOP_ROOT_KEY = "root-top";
export const TOP_ROOT_GENERATION = 0;

/** Pathological-page budgets. Exceeding them fails closed (abstain), never wrong-fills. */
export const MAX_ROOT_DEPTH = 6;
export const MAX_ACCESSIBLE_ROOTS = 32;
export const MAX_SHADOW_HOST_PROBES = 512;

/** Runtime question instance: root-scoped so identical questions in different roots never alias. */
export function questionInstanceKey(rootKey: string, stableId: string): string {
  return `${rootKey}\u0000${stableId}`;
}

export function topRootContext(topDocument: Document): RootContext {
  return {
    rootKey: TOP_ROOT_KEY,
    kind: "top-document",
    root: topDocument,
    ownerDocument: topDocument,
    ownerWindow: topDocument.defaultView ?? window,
    rootGeneration: TOP_ROOT_GENERATION,
    connected: true,
  };
}

export function rootAttachmentOf(block: QuestionBlock): RuntimeRootAttachment {
  return (block as { [RUNTIME_ROOT]?: RuntimeRootAttachment })[RUNTIME_ROOT]
    ?? { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" };
}

export function ownerOf(block: QuestionBlock): Element | undefined {
  return (block as { [RUNTIME_OWNER]?: Element | undefined })[RUNTIME_OWNER];
}

export function attachRuntimeRoot(block: QuestionBlock, attachment: RuntimeRootAttachment, owner?: Element): QuestionBlock {
  const attached = block as { [RUNTIME_ROOT]?: RuntimeRootAttachment; [RUNTIME_OWNER]?: Element | undefined };
  attached[RUNTIME_ROOT] = attachment;
  if (owner) {
    attached[RUNTIME_OWNER] = owner;
    const priorHandle = block.runtimeQuestionHandle;
    const stableId = block.identity?.stableId;
    const contentFingerprint = block.identity?.contentFingerprint;
    let handle: string | null = null;
    if (stableId && contentFingerprint) {
      for (const [candidateHandle, stored] of runtimeQuestionHandles) {
        if (stored.attachment.rootKey === attachment.rootKey
          && stored.attachment.rootGeneration === attachment.rootGeneration
          && stored.stableId === stableId
          && stored.contentFingerprint === contentFingerprint
          && stored.owner.deref() === owner) {
          handle = candidateHandle;
          break;
        }
      }
    }
    if (priorHandle && priorHandle !== handle) runtimeQuestionHandles.delete(priorHandle);
    if (!handle && stableId && contentFingerprint) handle = createRuntimeQuestionHandle();
    if (handle) {
      if (stableId && contentFingerprint) {
        runtimeQuestionHandles.set(handle, {
          attachment: { ...attachment },
          stableId,
          contentFingerprint,
          // Modern Chromium provides WeakRef. The bounded fallback keeps this
          // compatibility path from growing beyond the explicit handle cap.
          owner: WeakRefApi ? new WeakRefApi(owner) : { deref: () => owner },
        });
      }
      block.runtimeQuestionHandle = handle;
      while (runtimeQuestionHandles.size > MAX_RUNTIME_QUESTION_HANDLES) {
        const oldest = runtimeQuestionHandles.keys().next().value;
        if (!oldest) break;
        runtimeQuestionHandles.delete(oldest);
      }
    } else {
      delete block.runtimeQuestionHandle;
    }
  }
  return attached as QuestionBlock;
}

/** Read the sealed root and identity proof even when its previous owner detached. */
export function readRuntimeQuestionHandle(block: QuestionBlock): SealedRuntimeQuestionHandleRecord | null {
  const handle = block.runtimeQuestionHandle;
  if (typeof handle !== "string" || !/^rqh_[0-9a-f]{32}$/.test(handle)) return null;
  const stored = runtimeQuestionHandles.get(handle);
  const stableId = block.identity?.stableId;
  const contentFingerprint = block.identity?.contentFingerprint;
  if (!stored || !stableId || !contentFingerprint
    || stableId !== stored.stableId
    || contentFingerprint !== stored.contentFingerprint) return null;
  const owner = stored.owner.deref();
  return { attachment: { ...stored.attachment }, stableId, contentFingerprint, owner };
}

/** Resolve and bind only a live locator whose serialized semantic identity is exact. */
export function bindRuntimeQuestionHandle(block: QuestionBlock): RuntimeQuestionHandleRecord | null {
  const sealed = readRuntimeQuestionHandle(block);
  const owner = sealed?.owner;
  if (!sealed || !owner?.isConnected) return null;
  const attached = block as { [RUNTIME_ROOT]?: RuntimeRootAttachment; [RUNTIME_OWNER]?: Element | undefined };
  attached[RUNTIME_ROOT] = sealed.attachment;
  attached[RUNTIME_OWNER] = owner;
  return { attachment: { ...sealed.attachment }, stableId: sealed.stableId, contentFingerprint: sealed.contentFingerprint, owner };
}

/** Update a sealed handle only after its authoritative root has proven one exact live owner. */
export function rebindRuntimeQuestionHandle(
  block: QuestionBlock,
  attachment: RuntimeRootAttachment,
  owner: Element,
): RuntimeQuestionHandleRecord | null {
  const sealed = readRuntimeQuestionHandle(block);
  const handle = block.runtimeQuestionHandle;
  const stored = typeof handle === "string" ? runtimeQuestionHandles.get(handle) : undefined;
  if (!sealed || !stored || !owner.isConnected
    || sealed.attachment.rootKey !== attachment.rootKey
    || sealed.attachment.rootGeneration !== attachment.rootGeneration
    || sealed.attachment.kind !== attachment.kind) return null;
  stored.owner = WeakRefApi ? new WeakRefApi(owner) : { deref: () => owner };
  const attached = block as { [RUNTIME_ROOT]?: RuntimeRootAttachment; [RUNTIME_OWNER]?: Element | undefined };
  attached[RUNTIME_ROOT] = { ...sealed.attachment };
  attached[RUNTIME_OWNER] = owner;
  return { attachment: { ...sealed.attachment }, stableId: sealed.stableId, contentFingerprint: sealed.contentFingerprint, owner };
}

export function invalidateRuntimeQuestionHandlesForRoot(rootKey: string): void {
  for (const [handle, stored] of runtimeQuestionHandles) {
    if (stored.attachment.rootKey === rootKey) runtimeQuestionHandles.delete(handle);
  }
}

function createRuntimeQuestionHandle(): string | null {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) return null;
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return `rqh_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
