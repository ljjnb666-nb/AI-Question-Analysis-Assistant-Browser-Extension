import type React from "react";
import type { DetectedCandidate, QuestionBlock } from "@/shared/types";
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
  isAuthenticated: boolean;
  userEmail: string;
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
  fillFeedback: string;
  isAutoSolving: boolean;
  autoSolveProgress: AutoSolveProgressState;
};

export const initialSidePanelAppState: SidePanelAppState = {
  uiLang: "zh",
  isAuthenticated: false,
  userEmail: "",
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
  fillFeedback: "",
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
