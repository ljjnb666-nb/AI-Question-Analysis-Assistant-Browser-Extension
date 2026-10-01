import type React from "react";
import type { DetectedCandidate, QuestionBlock } from "@/shared/types";
import type { UserFeedback } from "@/shared/ui/userFeedback";
import type { UILang } from "./displayUtils";
import type { SidePanelTabId } from "./sidePanelShell";
import type { CandidateViewFilter } from "./sidepanelCandidateMetrics";

export type ScanProgressState = { progress: number; found: number; step: number; total: number } | null;

export type AutoSolveProgressState = {
  solved: number;
  filled: number;
  total: number;
  current: number;
  statusText: string;
  currentPreview?: string;
  currentBlock?: QuestionBlock;
} | null;

export type SidePanelAppState = {
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
}[keyof SidePanelAppState];

export function sidePanelAppReducer(state: SidePanelAppState, action: SidePanelAppAction): SidePanelAppState {
  const previousValue = state[action.type];
  const nextValue =
    typeof action.updater === "function"
      ? (action.updater as (value: typeof previousValue) => typeof previousValue)(previousValue)
      : action.updater;

  if (Object.is(previousValue, nextValue)) return state;
  return { ...state, [action.type]: nextValue };
}
