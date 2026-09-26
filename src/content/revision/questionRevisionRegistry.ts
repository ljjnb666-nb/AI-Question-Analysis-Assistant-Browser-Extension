import type { QuestionBlock } from "@/shared/types";
import { stableHash } from "../questionIdentity";
import { TOP_ROOT_GENERATION, TOP_ROOT_KEY, type RuntimeRootAttachment } from "../roots/rootContext";
import type { QuestionRevisionEvent, QuestionRuntimeVersion } from "./questionRevisionTypes";
import { versionFromBlock } from "./questionRevisionTypes";

export function routeFingerprintForLocation(locationHref = location.href): string {
  return `route_v1_${stableHash(locationHref)}`;
}

export function compareQuestionRuntimeRevision(
  previous: QuestionRuntimeVersion | undefined,
  current: QuestionRuntimeVersion | undefined,
): QuestionRevisionEvent {
  if (!previous || !current) return "REMOVED";
  if (previous.routeEpoch !== current.routeEpoch || previous.routeFingerprint !== current.routeFingerprint) return "ROUTE_CHANGED";
  if (previous.rootGeneration !== undefined && current.rootGeneration !== undefined && previous.rootGeneration !== current.rootGeneration) return "ROOT_REPLACED";
  if (previous.stableId !== current.stableId) return "REPLACED";
  if (previous.contentFingerprint !== current.contentFingerprint) return "REVISION_CHANGED";
  return previous.bindingEpoch === current.bindingEpoch ? "UNCHANGED" : "REBOUND";
}

export type RootScope = { rootKey?: string; rootGeneration?: number };

export const MAX_QUESTION_REVISION_ENTRIES = 512;

export function instanceKeyFor(rootKey: string | undefined, stableId: string): string {
  return `${rootKey ?? TOP_ROOT_KEY} ${stableId}`;
}

type OwnerBinding = { instanceKey: string; version: QuestionRuntimeVersion };

/** Runtime-only registry. It never persists DOM nodes and only retains the current owner binding in a WeakMap. */
export class QuestionRevisionRegistry {
  private readonly versions = new Map<string, QuestionRuntimeVersion>();
  private readonly owners = new WeakMap<Element, OwnerBinding>();
  private protectedInstanceKey: string | null = null;
  private routeEpoch = 0;
  private routeFingerprint = routeFingerprintForLocation();

  /** Read-only test/debug seam. */
  get size(): number { return this.versions.size; }

  protectInstance(instanceKey: string): void { this.protectedInstanceKey = instanceKey; }

  unprotectInstance(instanceKey: string): void {
    if (this.protectedInstanceKey === instanceKey) this.protectedInstanceKey = null;
  }

  getRoute(): Pick<QuestionRuntimeVersion, "routeEpoch" | "routeFingerprint"> {
    return { routeEpoch: this.routeEpoch, routeFingerprint: this.routeFingerprint };
  }

  refreshRoute(): boolean {
    const next = routeFingerprintForLocation();
    if (next === this.routeFingerprint) return false;
    this.routeFingerprint = next;
    this.routeEpoch += 1;
    return true;
  }

  observe(block: QuestionBlock, owner?: Element, root?: RootScope): { event: QuestionRevisionEvent; version: QuestionRuntimeVersion } {
    const rootKey = root?.rootKey ?? TOP_ROOT_KEY;
    const rootGeneration = root?.rootGeneration ?? TOP_ROOT_GENERATION;
    const stableId = block.identity?.stableId ?? block.id;
    const instanceKey = instanceKeyFor(rootKey, stableId);
    const previous = this.versions.get(instanceKey);
    const ownerBinding = owner ? this.owners.get(owner) : undefined;
    const base = versionFromBlock(block, this.routeEpoch, this.routeFingerprint, previous?.bindingEpoch ?? 0, { rootKey, rootGeneration });
    const ownerChanged = owner ? ownerBinding?.version.bindingEpoch !== previous?.bindingEpoch : false;
    const changedBinding = Boolean(previous && owner && ownerChanged);
    const version = { ...base, bindingEpoch: previous ? previous.bindingEpoch + (changedBinding ? 1 : 0) : 1 };

    let event = compareQuestionRuntimeRevision(previous, version);
    // A recycled owner (the same element now representing a different
    // question) is a replacement even when the new stableId was never seen
    // before — the old attempt must not stay active just because a version
    // lookup for the new stableId returns nothing.
    if (ownerBinding && ownerBinding.instanceKey !== instanceKey && event !== "ROOT_REPLACED") {
      event = "REPLACED";
    }

    // Map insertion order is the deterministic LRU order. Refreshing an
    // instance moves it to the newest position without changing its identity.
    this.versions.delete(instanceKey);
    this.versions.set(instanceKey, version);
    this.evictOldestVersions(instanceKey);
    if (owner) {
      this.owners.set(owner, { instanceKey, version });
    }
    return { event, version };
  }

  currentForInstance(instanceKey: string): QuestionRuntimeVersion | undefined {
    return this.versions.get(instanceKey);
  }

  currentForRoot(rootKey: string, stableId: string): QuestionRuntimeVersion | undefined {
    return this.versions.get(instanceKeyFor(rootKey, stableId));
  }

  removeForInstance(instanceKey: string): QuestionRuntimeVersion | undefined {
    const previous = this.versions.get(instanceKey);
    this.versions.delete(instanceKey);
    return previous;
  }

  /** Drop every version bound to a root (root removal / document replacement). */
  removeRoot(rootKey: string): void {
    const prefix = `${rootKey} `;
    for (const key of [...this.versions.keys()]) {
      if (key.startsWith(prefix)) this.versions.delete(key);
    }
  }

  private evictOldestVersions(newestInstanceKey: string): void {
    while (this.versions.size > MAX_QUESTION_REVISION_ENTRIES) {
      const oldest = [...this.versions.keys()].find((key) =>
        key !== newestInstanceKey && key !== this.protectedInstanceKey);
      if (!oldest) return;
      this.versions.delete(oldest);
    }
  }
}

export function rootScopeOfAttachment(attachment: RuntimeRootAttachment | undefined): RootScope | undefined {
  return attachment ? { rootKey: attachment.rootKey, rootGeneration: attachment.rootGeneration } : undefined;
}

export function instanceKeyOfBlock(block: QuestionBlock, root?: RootScope): string {
  return instanceKeyFor(root?.rootKey, block.identity?.stableId ?? block.id);
}
