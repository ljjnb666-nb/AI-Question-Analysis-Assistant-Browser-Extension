import type { CandidateSnapshot } from "./ui";
import type { AutoSolveProgressMsg, FullPageDetectProgressMsg } from "./messages";

export type DetectionPhase = "never_started" | "detecting" | "completed";
export interface WorkspaceMetadata {
  protocolVersion: 1;
  runtimeInstanceId: string;
  /** Document-local generation, distinct from the opaque instance identity. */
  runtimeGeneration: number;
  routeEpoch: number;
  seq: number;
  originUrl: string;
}
export interface CandidateWorkspaceSnapshot extends WorkspaceMetadata {
  detection: { phase: DetectionPhase; mode: "viewport" | "fullpage" | null; requestId?: string };
  candidates: CandidateSnapshot[];
  autoSolve: { running: boolean; progress: AutoSolveProgressMsg | null };
  fullPage: { running: boolean; progress: FullPageDetectProgressMsg | null };
  disposed: boolean;
}
export interface WorkspaceSnapshotResponse {
  ok: boolean;
  snapshot?: CandidateWorkspaceSnapshot;
}
