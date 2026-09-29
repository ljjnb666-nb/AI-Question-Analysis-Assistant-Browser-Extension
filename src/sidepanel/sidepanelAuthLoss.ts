import type { SidePanelAppState } from "./sidepanelAppState";

export type AuthLossStopPlan = {
  /** An auto-solve run is active and needs STOP_AUTO_SOLVE_ALL. */
  stopAutoSolve: boolean;
  /** A full-page scan is active and needs FULL_PAGE_DETECT_CANCELLED. */
  cancelFullPage: boolean;
};

/**
 * AUTH-UI-INV-11 — planning for auth loss while long-running protected work
 * is in flight. Hiding the UI does not stop work already dispatched to the
 * content script, so the transition out of `authenticated` must terminate it
 * best-effort and reset the transient protected-work flags.
 */
export function planAuthLossStop(state: SidePanelAppState): AuthLossStopPlan {
  return {
    stopAutoSolve: state.isAutoSolving,
    cancelFullPage: state.isFullPageScan,
  };
}
