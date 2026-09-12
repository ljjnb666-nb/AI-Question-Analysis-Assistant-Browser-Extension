import type { QuestionBlock } from "@/shared/types";

export type QuestionRuntimeVersion = {
  stableId: string;
  contentFingerprint: string;
  bindingEpoch: number;
  routeEpoch: number;
  routeFingerprint: string;
  /** Runtime root scope; defaults to the top document for legacy entries. */
  rootKey?: string;
  rootGeneration?: number;
};

export type QuestionRevisionEvent =
  | "UNCHANGED"
  | "REBOUND"
  | "REVISION_CHANGED"
  | "REMOVED"
  | "REPLACED"
  | "ROUTE_CHANGED"
  | "ROOT_REPLACED";

export type RevisionAttemptIdentity = Pick<QuestionRuntimeVersion, "stableId" | "contentFingerprint" | "routeEpoch" | "routeFingerprint"> & {
  rootKey?: string;
  rootGeneration?: number;
};

export function versionFromBlock(
  block: QuestionBlock,
  routeEpoch: number,
  routeFingerprint: string,
  bindingEpoch = 0,
  root?: { rootKey?: string; rootGeneration?: number },
): QuestionRuntimeVersion {
  return {
    stableId: block.identity?.stableId ?? block.id,
    contentFingerprint: block.identity?.contentFingerprint ?? block.id,
    bindingEpoch,
    routeEpoch,
    routeFingerprint,
    rootKey: root?.rootKey,
    rootGeneration: root?.rootGeneration,
  };
}
