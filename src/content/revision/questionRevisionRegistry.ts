import type { QuestionBlock } from "@/shared/types";
import { stableHash } from "../questionIdentity";
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
  if (previous.stableId !== current.stableId) return "REPLACED";
  if (previous.contentFingerprint !== current.contentFingerprint) return "REVISION_CHANGED";
  return previous.bindingEpoch === current.bindingEpoch ? "UNCHANGED" : "REBOUND";
}

/** Runtime-only registry. It never persists DOM nodes and only retains the current owner in a WeakMap. */
export class QuestionRevisionRegistry {
  private readonly versions = new Map<string, QuestionRuntimeVersion>();
  private readonly owners = new WeakMap<Element, QuestionRuntimeVersion>();
  private routeEpoch = 0;
  private routeFingerprint = routeFingerprintForLocation();

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

  observe(block: QuestionBlock, owner?: Element): { event: QuestionRevisionEvent; version: QuestionRuntimeVersion } {
    const identity = block.identity?.stableId ?? block.id;
    const previous = this.versions.get(identity);
    const base = versionFromBlock(block, this.routeEpoch, this.routeFingerprint, previous?.bindingEpoch ?? 0);
    const ownerChanged = owner ? this.owners.get(owner)?.bindingEpoch !== previous?.bindingEpoch : false;
    const changedBinding = Boolean(previous && owner && ownerChanged);
    const version = { ...base, bindingEpoch: previous ? previous.bindingEpoch + (changedBinding ? 1 : 0) : 1 };
    const event = compareQuestionRuntimeRevision(previous, version);
    this.versions.set(identity, version);
    if (owner) {
      this.owners.set(owner, version);
    }
    return { event, version };
  }

  current(stableId: string): QuestionRuntimeVersion | undefined { return this.versions.get(stableId); }

  remove(stableId: string): QuestionRuntimeVersion | undefined {
    const previous = this.versions.get(stableId);
    this.versions.delete(stableId);
    return previous;
  }
}
