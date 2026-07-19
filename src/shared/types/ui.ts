import type { ParseResult, ParseStatus, RouteUsed } from "./parse";
import type { QuestionBlock } from "./question";

export interface DetectedCandidate {
  block: QuestionBlock;
  selected: boolean;
  status: ParseStatus;
  result?: ParseResult;
  error?: string;
  debugInfo?: {
    imageAttached?: boolean;
    routeUsed?: RouteUsed;
  };
}

export interface CandidateSnapshot {
  block: QuestionBlock;
  selected: boolean;
  status: ParseStatus;
}

export interface FloatingWindowState {
  visible: boolean;
  minimized: boolean;
  loading: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export function getDefaultFloatingState(): FloatingWindowState {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  return {
    visible: false,
    minimized: false,
    loading: false,
    x: vw - 420,
    y: vh - 320,
    width: 380,
    height: 280,
    zIndex: 2147483640,
  };
}

export const DEFAULT_FLOATING_STATE: FloatingWindowState = {
  visible: false,
  minimized: false,
  loading: false,
  x: 860,
  y: 480,
  width: 380,
  height: 280,
  zIndex: 2147483640,
};
