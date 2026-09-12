import { isElementNode, isExtensionUiElement, isHtmlElementNode } from "../detector/domDetectorShared";
import type { QuestionBlock } from "@/shared/types";
import { TOP_ROOT_KEY, ownerOf, type RootContext, type TraversableRoot } from "../roots/rootContext";
import { sharedRootRegistry, type RootRegistryEvents } from "../roots/rootRegistry";
import {
  abortQuestionRevisionAttempt,
  abortQuestionRevisionAttemptForRoot,
  activeQuestionRevisionAttempt,
  revisionRegistry,
} from "./questionRevisionRuntime";
import { instanceKeyFor } from "./questionRevisionRegistry";
import type { QuestionRevisionEvent } from "./questionRevisionTypes";

const RELEVANT_ATTRIBUTES = ["src", "srcset", "style", "class", "alt", "aria-label", "aria-labelledby", "aria-disabled", "disabled", "checked", "value", "aria-checked", "aria-selected"];
const INTERACTION_ATTRIBUTES = new Set(["checked", "value", "aria-checked", "aria-selected"]);

export type QuestionRevisionWatchOptions = {
  detectCandidates: () => QuestionBlock[];
  onCandidates: (candidates: QuestionBlock[], rootKey?: string) => void;
  onEvent?: (event: QuestionRevisionEvent, rootKey?: string) => void;
  /** Root-aware detection for non-top roots (frames, open shadow roots). */
  detectRootCandidates?: (root: TraversableRoot, context: RootContext) => QuestionBlock[];
};

function isRelevantMutation(record: MutationRecord): boolean {
  const target =isElementNode( record.target) ? record.target : record.target.parentElement;
  if (target && isExtensionUiElement(target)) return false;
  if (record.type === "attributes") return !INTERACTION_ATTRIBUTES.has(record.attributeName ?? "");
  if (record.type === "characterData") return Boolean(target && !isExtensionUiElement(target));
  return record.addedNodes.length > 0 || record.removedNodes.length > 0;
}

type RootAttachment = { observer: MutationObserver; onLoad?: () => void };

/**
 * The single SPA semantic-watch owner. It owns one lifecycle for every
 * accessible root: the top document observer, one MutationObserver per
 * registered frame/shadow root, per-frame load listeners and the bounded root
 * reconciliation. Observer callbacks only mark roots dirty and schedule a
 * coalesced flush; canonical detection and revision comparison run outside.
 */
export function startQuestionRevisionWatch(options: QuestionRevisionWatchOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const roots = sharedRootRegistry();
  const revisions = revisionRegistry();

  const dirtyRoots = new Set<string>();
  const attached = new Map<string, RootAttachment>();
  const pendingFrameListeners = new WeakSet<HTMLIFrameElement>();

  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 50);
  };

  const observeRoot = (root: RootContext) => {
    if (attached.has(root.rootKey)) return;
    const observer = new MutationObserver((records) => {
      if (records.some(isRelevantMutation)) {
        dirtyRoots.add(root.rootKey);
        schedule();
      }
    });
    observer.observe(root.root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: RELEVANT_ATTRIBUTES });
    let onLoad: (() => void) | undefined;
    if (root.kind === "same-origin-frame" && root.frameElement) {
      onLoad = () => {
        dirtyRoots.add(root.rootKey);
        schedule();
      };
      root.frameElement.addEventListener("load", onLoad);
    }
    attached.set(root.rootKey, { observer, onLoad });
  };

  const detachRoot = (rootKey: string) => {
    const attachment = attached.get(rootKey);
    if (!attachment) return;
    attachment.observer.disconnect();
    const context = roots.get(rootKey);
    if (attachment.onLoad && context?.frameElement) {
      context.frameElement.removeEventListener("load", attachment.onLoad);
    }
    attached.delete(rootKey);
  };

  const handleRootLifecycle = (events: RootRegistryEvents) => {
    for (const rootKey of events.removedRootKeys) {
      detachRoot(rootKey);
      revisions.removeRoot(rootKey);
      abortQuestionRevisionAttemptForRoot(rootKey);
      options.onEvent?.("ROOT_REPLACED", rootKey);
    }
    for (const rootKey of events.replacedRootKeys) {
      // Same anchor, replaced document/generation: previous bindings are stale.
      abortQuestionRevisionAttemptForRoot(rootKey);
      options.onEvent?.("ROOT_REPLACED", rootKey);
      const context = roots.get(rootKey);
      if (context) {
        detachRoot(rootKey);
        observeRoot(context);
      }
    }
  };

  const detectRoot = (root: RootContext): QuestionBlock[] => {
    if (root.kind === "top-document" || !options.detectRootCandidates) {
      return options.detectCandidates();
    }
    try {
      return options.detectRootCandidates(root.root, root);
    } catch {
      // A root turning hostile mid-scan fails closed to zero candidates.
      return [];
    }
  };

  const flush = () => {
    timer = null;
    if (stopped) return;
    const dirty = new Set(dirtyRoots);
    dirtyRoots.clear();

    const events = roots.reconcile(document, dirty);
    handleRootLifecycle(events);
    // Observer attachment is idempotent with registry state: roots registered
    // by any reconcile (detection, watcher) must all be observed, and pruned
    // roots must lose their observers.
    for (const root of roots.list()) {
      observeRoot(root);
    }
    for (const rootKey of [...attached.keys()]) {
      if (!roots.get(rootKey)) detachRoot(rootKey);
    }
    // New iframes may appear at any time; each needs its own load listener
    // until its document becomes accessible (or it is pruned as cross-origin).
    watchPendingFrames();

    const scanned = new Map<string, { root: RootContext; blocks: QuestionBlock[] }>();
    const topRoot = roots.get(TOP_ROOT_KEY);
    if (topRoot) {
      scanned.set(TOP_ROOT_KEY, { root: topRoot, blocks: detectRoot(topRoot) });
    }
    for (const root of roots.list()) {
      if (root.kind === "top-document" || !dirty.has(root.rootKey)) continue;
      scanned.set(root.rootKey, { root, blocks: detectRoot(root) });
    }
    for (const [, entry] of scanned) {
      options.onCandidates(entry.blocks, entry.root.rootKey);
    }

    // Route tracking refreshes on every flush, matching the Phase 6 order,
    // so the stored fingerprint never trails the real location.
    const routeChanged = revisions.refreshRoute();
    const active = activeQuestionRevisionAttempt();
    if (!active) return;
    if (routeChanged) {
      options.onEvent?.("ROUTE_CHANGED", active.rootKey);
      abortQuestionRevisionAttempt();
      return;
    }

    const scannedActive = scanned.get(active.rootKey ?? TOP_ROOT_KEY);
    if (!scannedActive) return;

    const candidates = scannedActive.blocks;
    const sameId = candidates.find((block) => {
      const instanceKey = instanceKeyFor(active.rootKey, block.identity?.stableId ?? block.id);
      if (instanceKey === active.instanceKey) return true;
      return Boolean(active.nativeQuestionId && block.identity?.nativeQuestionId === active.nativeQuestionId);
    });
    if (!sameId) {
      const event: QuestionRevisionEvent = candidates.length ? "REPLACED" : "REMOVED";
      options.onEvent?.(event, active.rootKey);
      abortQuestionRevisionAttempt();
      return;
    }
    const fingerprint = sameId.identity?.contentFingerprint ?? sameId.id;
    if (fingerprint !== active.contentFingerprint) {
      options.onEvent?.("REVISION_CHANGED", active.rootKey);
      abortQuestionRevisionAttempt();
      return;
    }
    const observed = revisions.observe(sameId, ownerOf(sameId), {
      rootKey: active.rootKey,
      rootGeneration: scannedActive.root.rootGeneration,
    });
    options.onEvent?.(observed.event, active.rootKey);
    if (observed.event === "REPLACED" || observed.event === "ROOT_REPLACED") {
      abortQuestionRevisionAttempt();
    }
  };

  // A frame that exists but is not accessible yet (still loading, or
  // cross-origin) cannot be registered as a root. Attach a one-shot load
  // listener so same-origin frames register as soon as their document exists.
  // Cross-origin frames never fire an accessible root and stay out of scope.
  const watchPendingFrames = () => {
    for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
      if (pendingFrameListeners.has(iframe)) continue;
      pendingFrameListeners.add(iframe);
      const onFrameLoad = () => {
        iframe.removeEventListener("load", onFrameLoad);
        pendingFrameListeners.delete(iframe);
        dirtyRoots.add(TOP_ROOT_KEY);
        schedule();
      };
      iframe.addEventListener("load", onFrameLoad, { once: true });
    }
  };
  watchPendingFrames();

  const onRoute = () => schedule();
  addEventListener("popstate", onRoute);
  addEventListener("hashchange", onRoute);
  // Initial lifecycle pass so roots present before the watch starts are owned.
  handleRootLifecycle(roots.reconcile(document));
  const topRoot = roots.get(TOP_ROOT_KEY);
  if (topRoot) observeRoot(topRoot);

  return () => {
    stopped = true;
    for (const [rootKey, attachment] of [...attached]) {
      attachment.observer.disconnect();
      const context = roots.get(rootKey);
      if (attachment.onLoad && context?.frameElement) {
        context.frameElement.removeEventListener("load", attachment.onLoad);
      }
    }
    attached.clear();
    dirtyRoots.clear();
    roots.reset();
    removeEventListener("popstate", onRoute);
    removeEventListener("hashchange", onRoute);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
