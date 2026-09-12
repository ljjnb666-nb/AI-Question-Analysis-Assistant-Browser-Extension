import type { QuestionBlock } from "@/shared/types";
import type { TraversableRoot } from "./rootDom";
import {
  frameRectToTopViewport,
  getAccessibleFrameDocument,
  getTraversalRoot,
  topViewportPointToFrame,
  type ParentFrameResolver,
} from "./rootDom";
import {
  MAX_ACCESSIBLE_ROOTS,
  MAX_ROOT_DEPTH,
  MAX_SHADOW_HOST_PROBES,
  rootAttachmentOf,
  TOP_ROOT_GENERATION,
  TOP_ROOT_KEY,
  topRootContext,
  type RootContext,
} from "./rootContext";

export type ProjectedRect = { left: number; top: number; width: number; height: number };

/**
 * Builds a rect projector from a root's local coordinate space into top-tab
 * viewport coordinates. Shadow roots add no viewport of their own, so the
 * projection walks only the frame chain containing the root. Ambiguous
 * transforms (non-uniform scale, detached frame) yield null so callers abstain.
 */
export function createTopViewportProjector(registry: AccessibleRootRegistry, context: RootContext): (rect: ProjectedRect) => ProjectedRect | null {
  let frameRoot: RegisteredRoot | undefined;
  if (context.kind === "same-origin-frame") {
    frameRoot = registry.get(context.rootKey) as RegisteredRoot | undefined;
  } else {
    let key = context.parentRootKey;
    while (key) {
      const ancestor = registry.get(key);
      if (!ancestor) break;
      if (ancestor.kind === "same-origin-frame") {
        frameRoot = ancestor as RegisteredRoot;
        break;
      }
      key = ancestor.parentRootKey;
    }
  }
  const startFrame = frameRoot?.frameElement;
  if (!startFrame) return (rect) => ({ ...rect });

  const resolver: ParentFrameResolver = (doc) => {
    let key: string | undefined = frameRoot?.rootKey;
    while (key) {
      const registered = registry.get(key);
      if (!registered) break;
      if (registered.kind === "same-origin-frame" && registered.root === doc) return registered.frameElement ?? null;
      key = registered.parentRootKey;
    }
    try {
      return doc.defaultView && doc.defaultView.frameElement instanceof HTMLIFrameElement ? doc.defaultView.frameElement : null;
    } catch {
      return null;
    }
  };

  return (rect) => {
    const result = frameRectToTopViewport(startFrame, rect, resolver);
    return result.ok ? { left: result.left, top: result.top, width: result.width, height: result.height } : null;
  };
}

export type RootRegistryEvents = {
  addedRootKeys: string[];
  replacedRootKeys: string[];
  removedRootKeys: string[];
  budgetExceeded: boolean;
};

type RegisteredRoot = RootContext & {
  anchorDocument: Document;
  anchorFrame?: HTMLIFrameElement;
  anchorHost?: Element;
};

/**
 * Runtime-only registry of accessible roots. It discovers same-origin frames
 * and open shadow roots, tracks document replacement via root generations,
 * prunes disconnected roots and enforces depth/count budgets. It never
 * persists DOM: strong references exist only for currently connected roots
 * and every root is dropped as soon as its anchor detaches.
 */
export class AccessibleRootRegistry {
  private readonly roots = new Map<string, RegisteredRoot>();
  private readonly keyByFrame = new WeakMap<HTMLIFrameElement, string>();
  private readonly keyByShadowRoot = new WeakMap<ShadowRoot, string>();
  private readonly probedRootKeys = new Set<string>();
  private counter = 0;

  reconcile(topDocument: Document, dirtyRootKeys?: ReadonlySet<string>): RootRegistryEvents {
    const events: RootRegistryEvents = {
      addedRootKeys: [],
      replacedRootKeys: [],
      removedRootKeys: [],
      budgetExceeded: false,
    };
    this.ensureTopRoot(topDocument);
    const budget = { count: this.roots.size, depth: 0 };

    // Same-origin frames, discovered from the top document and recursively
    // from every registered frame document, bounded by depth and count.
    const topRoot = this.roots.get(TOP_ROOT_KEY);
    if (topRoot) this.reconcileFramesOf(topRoot, events, budget);

    // Open shadow roots are discovered on dirty/new roots only — never as an
    // unbounded page-wide scan. Every root is probed once when first seen so
    // pre-existing hosts are not missed.
    const probeRootKeys = new Set<string>(events.addedRootKeys);
    if (dirtyRootKeys) for (const key of dirtyRootKeys) probeRootKeys.add(key);
    for (const root of [...this.roots.values()]) {
      if (!this.probedRootKeys.has(root.rootKey)) probeRootKeys.add(root.rootKey);
    }
    for (const root of [...this.roots.values()]) {
      if (!probeRootKeys.has(root.rootKey)) continue;
      this.probedRootKeys.add(root.rootKey);
      this.discoverShadowHosts(root, events, budget, probeRootKeys);
    }

    this.pruneDisconnected(events);
    return events;
  }

  get(rootKey: string): RootContext | undefined {
    return this.roots.get(rootKey);
  }

  list(): RootContext[] {
    return [...this.roots.values()];
  }

  rootKeyOfRoot(root: TraversableRoot): string | undefined {
    if (root === this.roots.get(TOP_ROOT_KEY)?.root) return TOP_ROOT_KEY;
    const shadowKey = this.keyByShadowRoot.get(root as ShadowRoot);
    if (shadowKey) return shadowKey;
    for (const registered of this.roots.values()) {
      if (registered.kind === "same-origin-frame" && registered.root === root) return registered.rootKey;
    }
    return undefined;
  }

  reset(): void {
    this.roots.clear();
    this.probedRootKeys.clear();
    this.counter = 0;
  }

  private ensureTopRoot(topDocument: Document): void {
    if (this.roots.has(TOP_ROOT_KEY)) return;
    this.roots.set(TOP_ROOT_KEY, {
      rootKey: TOP_ROOT_KEY,
      kind: "top-document",
      root: topDocument,
      ownerDocument: topDocument,
      ownerWindow: topDocument.defaultView ?? window,
      rootGeneration: TOP_ROOT_GENERATION,
      connected: true,
      anchorDocument: topDocument,
    });
  }

  private reconcileFramesOf(parent: RegisteredRoot, events: RootRegistryEvents, budget: { count: number; depth: number }): void {
    if (budget.depth >= MAX_ROOT_DEPTH) return;
    budget.depth += 1;
    try {
      const iframes = Array.from(parent.root.querySelectorAll("iframe")) as HTMLIFrameElement[];
      for (const iframe of iframes) {
        if (budget.count >= MAX_ACCESSIBLE_ROOTS) {
          events.budgetExceeded = true;
          break;
        }
        if (!iframe.isConnected) continue;
        const doc = getAccessibleFrameDocument(iframe);
        if (!doc) {
          // A previously accessible frame that became inaccessible is pruned
          // like any other disappeared root.
          this.removeRootByKey(this.keyByFrame.get(iframe), events);
          continue;
        }
        const existingKey = this.keyByFrame.get(iframe);
        const existing = existingKey ? this.roots.get(existingKey) : undefined;
        if (existing && existing.root === doc) {
          existing.connected = true;
          this.reconcileFramesOf(existing, events, budget);
          continue;
        }
        if (existing) {
          // Same iframe element, replaced document: same key, new generation.
          existing.root = doc;
          existing.ownerDocument = doc;
          existing.ownerWindow = doc.defaultView ?? existing.ownerWindow;
          existing.rootGeneration += 1;
          events.replacedRootKeys.push(existing.rootKey);
          this.reconcileFramesOf(existing, events, budget);
          continue;
        }
        const rootKey = `root-frame-${++this.counter}`;
        const root: RegisteredRoot = {
          rootKey,
          kind: "same-origin-frame",
          root: doc,
          ownerDocument: doc,
          ownerWindow: doc.defaultView ?? parent.ownerWindow,
          parentRootKey: parent.rootKey,
          frameElement: iframe,
          rootGeneration: 1,
          connected: true,
          anchorDocument: doc,
          anchorFrame: iframe,
        };
        this.roots.set(rootKey, root);
        this.keyByFrame.set(iframe, rootKey);
        budget.count += 1;
        events.addedRootKeys.push(rootKey);
        this.reconcileFramesOf(root, events, budget);
      }
    } catch {
      // Hostile tree access: skip this subtree, fail closed.
    } finally {
      budget.depth -= 1;
    }
  }

  private discoverShadowHosts(parent: RegisteredRoot, events: RootRegistryEvents, budget: { count: number; depth: number }, probeRootKeys: Set<string>): void {
    if (budget.depth >= MAX_ROOT_DEPTH) return;
    budget.depth += 1;
    try {
      const elements = Array.from(parent.root.querySelectorAll("*")).slice(0, MAX_SHADOW_HOST_PROBES);
      for (const host of elements) {
        if (budget.count >= MAX_ACCESSIBLE_ROOTS) {
          events.budgetExceeded = true;
          break;
        }
        const shadowRoot = (host as HTMLElement).shadowRoot;
        if (!shadowRoot) continue;
        const existingKey = this.keyByShadowRoot.get(shadowRoot);
        const existing = existingKey ? this.roots.get(existingKey) : undefined;
        if (existing) {
          existing.connected = true;
          // Slotted light DOM may itself contain frames; keep the chain walking.
          this.reconcileFramesOf(existing, events, budget);
          this.discoverShadowHosts(existing, events, budget, probeRootKeys);
          continue;
        }
        const rootKey = `root-shadow-${++this.counter}`;
        const root: RegisteredRoot = {
          rootKey,
          kind: "open-shadow-root",
          root: shadowRoot,
          ownerDocument: parent.ownerDocument,
          ownerWindow: parent.ownerWindow,
          parentRootKey: parent.rootKey,
          shadowHost: host,
          rootGeneration: 1,
          connected: true,
          anchorDocument: parent.anchorDocument,
          anchorHost: host,
        };
        this.roots.set(rootKey, root);
        this.keyByShadowRoot.set(shadowRoot, rootKey);
        budget.count += 1;
        events.addedRootKeys.push(rootKey);
        this.reconcileFramesOf(root, events, budget);
        this.discoverShadowHosts(root, events, budget, probeRootKeys);
      }
    } catch {
      // Fail closed on hostile trees.
    } finally {
      budget.depth -= 1;
    }
  }

  private removeRootByKey(rootKey: string | undefined, events: RootRegistryEvents): void {
    if (!rootKey) return;
    const root = this.roots.get(rootKey);
    if (!root) return;
    this.roots.delete(rootKey);
    events.removedRootKeys.push(rootKey);
    // Descendants of a removed root are removed with it.
    for (const child of [...this.roots.values()]) {
      if (child.parentRootKey === rootKey) this.removeRootByKey(child.rootKey, events);
    }
  }

  private pruneDisconnected(events: RootRegistryEvents): void {
    for (const root of [...this.roots.values()]) {
      if (root.kind === "top-document") continue;
      const anchor = root.anchorFrame ?? root.anchorHost;
      const connected = root.anchorFrame
        ? root.anchorFrame.isConnected && getAccessibleFrameDocument(root.anchorFrame) === root.root
        : Boolean(anchor && anchor.isConnected && (anchor as HTMLElement).shadowRoot === root.root);
      if (connected) continue;
      this.removeRootByKey(root.rootKey, events);
    }
  }
}

export type FillRootContext =
  | { ok: true; context: RootContext; doc: Document; shadowRoot: ShadowRoot | null; localBBox: { x: number; y: number; width: number; height: number } }
  | { ok: false; reason: "STALE_ROOT_CONTEXT" };

/**
 * Resolves the runtime fill context for a detected block: the root must still
 * be connected with the generation the block was detected under, and the
 * top-viewport bbox is converted into the root's local coordinate space.
 */
export function resolveFillRootContext(registry: AccessibleRootRegistry, block: QuestionBlock): FillRootContext {
  const attachment = rootAttachmentOf(block);
  // Top-document blocks never depend on registry lifecycle state: a registry
  // that has not reconciled yet must not fail the classic top-document path.
  if (!attachment.rootKey || attachment.rootKey === TOP_ROOT_KEY) {
    const topDocument = registry.get(TOP_ROOT_KEY)?.ownerDocument ?? document;
    return {
      ok: true,
      context: topRootContext(topDocument),
      doc: topDocument,
      shadowRoot: null,
      localBBox: { x: block.bbox.x, y: block.bbox.y, width: block.bbox.width, height: block.bbox.height },
    };
  }
  const context = registry.get(attachment.rootKey);
  if (!context || !context.connected || context.rootGeneration !== attachment.rootGeneration) {
    return { ok: false, reason: "STALE_ROOT_CONTEXT" };
  }

  const nearestFrame = (() => {
    if (context.kind === "same-origin-frame") return context;
    let key = context.parentRootKey;
    while (key) {
      const ancestor = registry.get(key);
      if (!ancestor) break;
      if (ancestor.kind === "same-origin-frame") return ancestor;
      key = ancestor.parentRootKey;
    }
    return undefined;
  })();

  const topToLocal = (topPoint: { x: number; y: number }) => {
    if (!nearestFrame?.frameElement) return { ok: true as const, point: { ...topPoint } };
    const resolver = createTopViewportProjector(registry, context);
    void resolver;
    return topViewportPointToFrame(nearestFrame.frameElement, topPoint, (doc) => {
      // Walk the registered ancestor chain of this root's document.
      const ownerRoot = registry.list().find((root) => root.kind === "same-origin-frame" && root.root === doc);
      if (ownerRoot) return ownerRoot.frameElement ?? null;
      try {
        return doc.defaultView && doc.defaultView.frameElement instanceof HTMLIFrameElement ? doc.defaultView.frameElement : null;
      } catch {
        return null;
      }
    });
  };

  const topLeft = topToLocal({ x: block.bbox.x, y: block.bbox.y });
  if (!topLeft.ok) return { ok: false, reason: "STALE_ROOT_CONTEXT" };
  const bottomRight = topToLocal({ x: block.bbox.x + block.bbox.width, y: block.bbox.y + block.bbox.height });
  if (!bottomRight.ok) return { ok: false, reason: "STALE_ROOT_CONTEXT" };

  const localBBox = {
    x: Math.min(topLeft.point.x, bottomRight.point.x),
    y: Math.min(topLeft.point.y, bottomRight.point.y),
    width: Math.abs(bottomRight.point.x - topLeft.point.x),
    height: Math.abs(bottomRight.point.y - topLeft.point.y),
  };

  const shadowRoot = context.kind === "open-shadow-root" ? (context.root as ShadowRoot) : null;
  const doc = shadowRoot ? context.ownerDocument : (context.root as Document);
  return { ok: true, context, doc, shadowRoot, localBBox };
}

/**
 * Transforms a point that belongs to an element's local coordinate space into
 * top-tab viewport coordinates. Identity for top-document and pure-shadow
 * content (shadow roots add no viewport); frame chains are walked with the
 * same provable-scale rules. Ambiguous transforms return null (abstain).
 */
export function topViewportPointForElement(registry: AccessibleRootRegistry, element: Element, point: { x: number; y: number }): { x: number; y: number } | null {
  const root = getTraversalRoot(element);
  const topRoot = registry.get(TOP_ROOT_KEY);
  if (!topRoot || root === topRoot.root) return point;
  const context = registry.rootKeyOfRoot(root);
  if (!context) return null;
  const rootContext = registry.get(context)!;

  const nearestFrame = (() => {
    if (rootContext.kind === "same-origin-frame") return rootContext;
    let key = rootContext.parentRootKey;
    while (key) {
      const ancestor = registry.get(key);
      if (!ancestor) break;
      if (ancestor.kind === "same-origin-frame") return ancestor;
      key = ancestor.parentRootKey;
    }
    return undefined;
  })();
  if (!nearestFrame?.frameElement) return point;

  const resolver: ParentFrameResolver = (doc) => {
    let key: string | undefined = nearestFrame.rootKey;
    while (key) {
      const registered = registry.get(key);
      if (!registered) break;
      if (registered.kind === "same-origin-frame" && registered.root === doc) return registered.frameElement ?? null;
      key = registered.parentRootKey;
    }
    try {
      return doc.defaultView && doc.defaultView.frameElement instanceof HTMLIFrameElement ? doc.defaultView.frameElement : null;
    } catch {
      return null;
    }
  };
  const result = topViewportPointToFrame(nearestFrame.frameElement, point, resolver);
  return result.ok ? result.point : null;
}

/** The process-wide registry used by the watcher, detection and fill paths. */
const sharedRegistry = new AccessibleRootRegistry();
export function sharedRootRegistry(): AccessibleRootRegistry {
  return sharedRegistry;
}
export type { TraversableRoot };
