import type React from "react";
import type { CandidateOrigin, CandidateWorkspaceSnapshot, DetectedCandidate, DetectionPhase, FullPageDetectOutcome } from "@/shared/types";
import type { WorkspaceHydrationStatus } from "./workspaceHydration";
import { mapAutoSolveProgressMessage, mapFullPageProgressMessage, mergeCandidateSnapshots } from "./sidepanelStateSync";
import { sameCandidateResultContext } from "./candidateAuthority";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import type { UILang } from "./displayUtils";
import type { SidePanelTabId } from "./sidePanelShell";
import type { CandidateViewFilter } from "./sidepanelCandidateMetrics";
import type { AutoSolveProgressState, ScanProgressState } from "./sidepanelStateSync";

// UI-00B review fix P2: single authoritative progress types (with the
// statusCode/statusDetail contract) re-exported for this module's consumers.
export type { AutoSolveProgressState, ScanProgressState };

export type SidePanelAppState = {
  hydrationStatus: WorkspaceHydrationStatus;
  workspaceOrigin: CandidateOrigin | undefined;
  detectionPhase: DetectionPhase;
  detectionOutcome: FullPageDetectOutcome | undefined;
  uiLang: UILang;
  /** Server-validated session status; never derived from local storage. */
  authStatus: "loading" | "validating" | "authenticated" | "unauthenticated" | "server_unavailable";
  isAuthenticated: boolean;
  userEmail: string;
  sessionRejected: boolean;
  tab: SidePanelTabId;
  candidates: DetectedCandidate[];
  isDetecting: boolean;
  isFullPageScan: boolean;
  scanProgress: ScanProgressState;
  isBatchParsing: boolean;
  isBatchFilling: boolean;
  isRetryingRisky: boolean;
  expandedIds: Record<string, boolean>;
  candidateViewFilter: CandidateViewFilter;
  /** UI-00B: typed feedback; `null` clears it. */
  fillFeedback: UserFeedback | null;
  isAutoSolving: boolean;
  autoSolveProgress: AutoSolveProgressState;
};

export const initialSidePanelAppState: SidePanelAppState = {
  hydrationStatus: "idle",
  workspaceOrigin: undefined,
  detectionPhase: "never_started",
  detectionOutcome: undefined,
  uiLang: "zh",
  authStatus: "loading",
  isAuthenticated: false,
  userEmail: "",
  sessionRejected: false,
  tab: "candidates",
  candidates: [],
  isDetecting: false,
  isFullPageScan: false,
  scanProgress: null,
  isBatchParsing: false,
  isBatchFilling: false,
  isRetryingRisky: false,
  expandedIds: {},
  candidateViewFilter: "all",
  fillFeedback: null,
  isAutoSolving: false,
  autoSolveProgress: null,
};

type ReducerAction<T extends keyof SidePanelAppState> = {
  type: T;
  updater: React.SetStateAction<SidePanelAppState[T]>;
};

export type SidePanelAppAction = {
  [K in keyof SidePanelAppState]: ReducerAction<K>;
}[keyof SidePanelAppState] | { type: "hydrateWorkspace"; status: WorkspaceHydrationStatus; snapshot?: CandidateWorkspaceSnapshot; origin?: CandidateOrigin };

export function sidePanelAppReducer(state: SidePanelAppState, action: SidePanelAppAction): SidePanelAppState {
  if (action.type === "hydrateWorkspace") {
    const s = action.snapshot;
    const candidates = s ? mergeCandidateSnapshots(state.candidates, s.candidates.map((item) => {
      const old = state.candidates.find((c) => c.block.id === item.block.id);
      // Panel-local parse evidence remains local; a content status cannot create it.
      return item.status === "idle" && old && sameCandidateResultContext(old, { block: item.block, origin: action.origin })
        && (old.result || old.status === "loading") ? { ...item, status: old.status } : item;
    }), action.origin).map((c) => c.status === "success" && !c.result ? { ...c, status: "idle" as const } : c) : [];
    return { ...state, hydrationStatus: action.status, workspaceOrigin: action.origin,
      detectionPhase: s?.detection.phase ?? "never_started",
      detectionOutcome: s?.detection.outcome, candidates,
      isDetecting: s?.detection.phase === "detecting" && s.detection.mode === "viewport",
      isFullPageScan: s?.fullPage.running ?? false,
      scanProgress: s?.fullPage.running && s.fullPage.progress ? mapFullPageProgressMessage({ ...s.fullPage.progress }) : null,
      isAutoSolving: s?.autoSolve.running ?? false,
      autoSolveProgress: s?.autoSolve.progress ? mapAutoSolveProgressMessage({ ...s.autoSolve.progress }) : null,
      fillFeedback: action.status === "ready" ? state.fillFeedback : null,
    };
  }
  const previousValue = state[action.type];
  const nextValue =
    typeof action.updater === "function"
      ? (action.updater as (value: typeof previousValue) => typeof previousValue)(previousValue)
      : action.updater;

  if (Object.is(previousValue, nextValue)) return state;
  return { ...state, [action.type]: nextValue };
}
