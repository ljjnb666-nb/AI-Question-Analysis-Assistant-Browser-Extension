export type ControlRole = "option" | "blank" | "text-answer";
export type ControlType = "radio" | "checkbox" | "text" | "textarea" | "contenteditable" | "custom-choice";
export type ControlMappingReason = "EXPLICIT_LABEL" | "INPUT_VALUE" | "ASSOCIATED_LABEL" | "WRAPPING_LABEL" | "ARIA_LABEL" | "SEMANTIC_CONTAINER" | "DOM_ORDER_FALLBACK" | "UNIQUE_TEXT_CONTROL" | "SEMANTIC_BLANK_COUNT";

export interface ControlRef {
  controlId: string;
  questionId: string;
  role: ControlRole;
  optionKey?: string;
  blankIndex?: number;
  controlType: ControlType;
  semanticFingerprint: string;
  semanticText?: string;
  enabled: boolean;
  visible: boolean;
  confidence: number;
  reasons: ControlMappingReason[];
}

export const MAX_CONTROL_REGISTRY_ENTRIES = 512;

type WeakObjectRef<T extends object> = { deref(): T | undefined };
type WeakRefConstructor = new <T extends object>(target: T) => WeakObjectRef<T>;
const WeakRefApi = (globalThis as typeof globalThis & { WeakRef?: WeakRefConstructor }).WeakRef;

type StoredControl = {
  element: WeakObjectRef<HTMLElement>;
  owner: WeakObjectRef<Element>;
  questionId: string;
  semanticFingerprint: string;
  rootKey: string;
  rootGeneration: number;
  scopeKey: string;
  lifecycleToken: number;
};

export type ControlMetadata = {
  element: HTMLElement;
  owner: Element;
  questionId: string;
  semanticFingerprint: string;
  rootKey: string;
  rootGeneration: number;
  lifecycleToken: number;
};

type ScopeToken = { token: number; questionId: string; rootKey: string; rootGeneration: number };

/** Runtime-only DOM references are weak and scope metadata has a deterministic cap. */
export class ControlRegistry {
  private readonly elements = new Map<string, StoredControl>();
  private readonly scopes = new Map<string, ScopeToken>();
  private readonly pinnedControls = new Map<string, number>();
  private readonly pinnedTokens = new Map<number, number>();
  private readonly transactionTokens: number[] = [];
  private nextLifecycleToken = 0;

  /** Read-only test/debug seam. */
  get size(): number { return this.elements.size; }

  /** Read-only test/debug seam; optional scope arguments keep identical questions isolated by root. */
  entryCountForQuestion(questionId: string, rootKey?: string, rootGeneration?: number): number {
    return [...this.elements.values()].filter((entry) => entry.questionId === questionId
      && (rootKey === undefined || entry.rootKey === rootKey)
      && (rootGeneration === undefined || entry.rootGeneration === rootGeneration)).length;
  }

  /** Read-only test/debug seam. */
  entryCountForRoot(rootKey: string, rootGeneration?: number): number {
    return [...this.elements.values()].filter((entry) => entry.rootKey === rootKey
      && (rootGeneration === undefined || entry.rootGeneration === rootGeneration)).length;
  }

  lifecycleToken(questionId: string, rootKey: string, rootGeneration: number): number | null {
    const scopeKey = this.scopeKey(questionId, rootKey, rootGeneration);
    const current = this.scopes.get(scopeKey);
    if (current) {
      this.scopes.delete(scopeKey);
      this.scopes.set(scopeKey, current);
      return current.token;
    }

    while (this.scopes.size >= MAX_CONTROL_REGISTRY_ENTRIES) {
      const evictableKey = [...this.scopes].find(([, scope]) => !this.isTokenPinned(scope.token))?.[0];
      if (!evictableKey) return null;
      this.clearScope(evictableKey);
    }

    const scope = { token: ++this.nextLifecycleToken, questionId, rootKey, rootGeneration };
    this.scopes.set(scopeKey, scope);
    return scope.token;
  }

  /** Weakly register a control. Returns false only when this mapping cannot be retained safely. */
  put(ref: ControlRef, element: HTMLElement, owner: Element, rootKey: string, rootGeneration: number, lifecycleToken: number): boolean {
    if (!WeakRefApi) return false;
    const scopeKey = this.scopeKey(ref.questionId, rootKey, rootGeneration);
    if (this.scopes.get(scopeKey)?.token !== lifecycleToken) return false;
    this.pruneDetached();

    if (!this.elements.has(ref.controlId)) {
      while (this.elements.size >= MAX_CONTROL_REGISTRY_ENTRIES) {
        const evictableId = [...this.elements].find(([id]) => !this.isControlPinned(id))?.[0];
        if (!evictableId) return false;
        const evicted = this.elements.get(evictableId);
        if (evicted) this.clearScope(evicted.scopeKey);
      }
    } else {
      this.elements.delete(ref.controlId);
    }

    this.elements.set(ref.controlId, {
      element: new WeakRefApi(element),
      owner: new WeakRefApi(owner),
      questionId: ref.questionId,
      semanticFingerprint: ref.semanticFingerprint,
      rootKey,
      rootGeneration,
      scopeKey,
      lifecycleToken,
    });
    return true;
  }

  get(controlId: string): HTMLElement | null {
    return this.metadata(controlId)?.element ?? null;
  }

  metadata(controlId: string): ControlMetadata | null {
    const stored = this.elements.get(controlId);
    if (!stored) return null;
    const element = stored.element.deref();
    const owner = stored.owner.deref();
    if (!element || !owner || !element.isConnected || !owner.isConnected) {
      this.deleteEntry(controlId);
      return null;
    }
    return {
      element,
      owner,
      questionId: stored.questionId,
      semanticFingerprint: stored.semanticFingerprint,
      rootKey: stored.rootKey,
      rootGeneration: stored.rootGeneration,
      lifecycleToken: stored.lifecycleToken,
    };
  }

  delete(controlId: string): void { this.deleteEntry(controlId); }

  clear(questionId?: string): void {
    if (questionId === undefined) {
      this.elements.clear();
      this.scopes.clear();
      return;
    }
    this.clearQuestion(questionId);
  }

  clearQuestion(questionId: string, rootKey?: string, rootGeneration?: number): void {
    for (const [scopeKey, scope] of this.scopes) {
      if (scope.questionId !== questionId
        || (rootKey !== undefined && scope.rootKey !== rootKey)
        || (rootGeneration !== undefined && scope.rootGeneration !== rootGeneration)) continue;
      this.clearScope(scopeKey);
    }
    // A partial mapping may have entries whose scope token was evicted earlier.
    for (const [id, entry] of this.elements) {
      if (entry.questionId === questionId
        && (rootKey === undefined || entry.rootKey === rootKey)
        && (rootGeneration === undefined || entry.rootGeneration === rootGeneration)) this.deleteEntry(id);
    }
  }

  clearRoot(rootKey: string): void {
    for (const [scopeKey, scope] of this.scopes) if (scope.rootKey === rootKey) this.clearScope(scopeKey);
    for (const [id, entry] of this.elements) if (entry.rootKey === rootKey) this.deleteEntry(id);
  }

  /** Keep the transaction's current mapping out of deterministic capacity eviction. */
  withPinnedMapping<T>(lifecycleToken: number, controlIds: readonly string[], operation: () => T): T {
    for (const id of controlIds) this.increment(this.pinnedControls, id);
    this.increment(this.pinnedTokens, lifecycleToken);
    this.transactionTokens.push(lifecycleToken);
    try {
      return operation();
    } finally {
      this.transactionTokens.pop();
      for (const id of controlIds) this.decrement(this.pinnedControls, id);
      this.decrement(this.pinnedTokens, lifecycleToken);
    }
  }

  isCurrentTransactionToken(lifecycleToken: number): boolean {
    return this.transactionTokens[this.transactionTokens.length - 1] === lifecycleToken;
  }

  private scopeKey(questionId: string, rootKey: string, rootGeneration: number): string {
    return JSON.stringify([questionId, rootKey, rootGeneration]);
  }

  private clearScope(scopeKey: string): void {
    this.scopes.delete(scopeKey);
    for (const [id, entry] of this.elements) if (entry.scopeKey === scopeKey) this.deleteEntry(id);
  }

  private pruneDetached(): void {
    for (const [id, entry] of this.elements) {
      const element = entry.element.deref();
      const owner = entry.owner.deref();
      if (!element || !owner || !element.isConnected || !owner.isConnected) this.deleteEntry(id);
    }
  }

  private deleteEntry(controlId: string): void { this.elements.delete(controlId); }
  private isControlPinned(controlId: string): boolean { return (this.pinnedControls.get(controlId) ?? 0) > 0; }
  private isTokenPinned(token: number): boolean { return (this.pinnedTokens.get(token) ?? 0) > 0; }

  private increment<K>(map: Map<K, number>, key: K): void { map.set(key, (map.get(key) ?? 0) + 1); }
  private decrement<K>(map: Map<K, number>, key: K): void {
    const count = map.get(key) ?? 0;
    if (count <= 1) map.delete(key);
    else map.set(key, count - 1);
  }
}

export const controlRegistry = new ControlRegistry();
