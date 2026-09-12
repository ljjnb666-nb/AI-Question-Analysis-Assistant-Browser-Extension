import type { QuestionBlock } from "@/shared/types";

export type QuestionRuntimeVersion = {
  stableId: string;
  contentFingerprint: string;
  bindingEpoch: number;
  routeEpoch: number;
  routeFingerprint: string;
};

export type QuestionRevisionEvent =
  | "UNCHANGED"
  | "REBOUND"
  | "REVISION_CHANGED"
  | "REMOVED"
  | "REPLACED"
  | "ROUTE_CHANGED";

export type RevisionAttemptIdentity = Pick<QuestionRuntimeVersion, "stableId" | "contentFingerprint" | "routeEpoch" | "routeFingerprint">;

export function versionFromBlock(block: QuestionBlock, routeEpoch: number, routeFingerprint: string, bindingEpoch = 0): QuestionRuntimeVersion {
  return {
    stableId: block.identity?.stableId ?? block.id,
    contentFingerprint: block.identity?.contentFingerprint ?? block.id,
    bindingEpoch,
    routeEpoch,
    routeFingerprint,
  };
}
