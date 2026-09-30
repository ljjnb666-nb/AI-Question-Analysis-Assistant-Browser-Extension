export type AuthLossWorkState = {
  /** An auto-solve run is active and needs STOP_AUTO_SOLVE_ALL. */
  isAutoSolving: boolean;
  /** A full-page scan is active and needs FULL_PAGE_DETECT_CANCELLED. */
  isFullPageScan: boolean;
};

export type AuthLossStopPlan = {
  stopAutoSolve: boolean;
  cancelFullPage: boolean;
};

/**
 * AUTH-UI-INV-11 + INV-13 — planning for auth loss while long-running
 * protected work is in flight. Hiding the UI does not stop work already
 * dispatched to the content script, so the transition out of
 * `authenticated` must terminate it best-effort and reset the transient
 * protected-work flags. The work state comes from the synchronous
 * protected-work registry, not a passive-effect snapshot.
 */
export function planAuthLossStop(work: AuthLossWorkState): AuthLossStopPlan {
  return {
    stopAutoSolve: work.isAutoSolving,
    cancelFullPage: work.isFullPageScan,
  };
}
