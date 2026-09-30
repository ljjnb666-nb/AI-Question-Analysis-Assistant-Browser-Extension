export type AuthLossWorkState = {
  /** An auto-solve run is active, owned by this content tab. */
  isAutoSolving: boolean;
  autoSolveTabId?: number;
  /** A full-page scan is active, owned by this content tab. */
  isFullPageScan: boolean;
  fullPageTabId?: number;
};

export type AuthLossStopPlan = {
  stopAutoSolve: boolean;
  autoSolveTabId?: number;
  cancelFullPage: boolean;
  fullPageTabId?: number;
};

/**
 * AUTH-UI-INV-11 + INV-13 — planning for auth loss while long-running
 * protected work is in flight. Hiding the UI does not stop work already
 * dispatched to the content script, so the transition out of
 * `authenticated` must terminate it best-effort and reset the transient
 * protected-work flags. Termination targets the RECORDED owner tab — the
 * watchdog must never guess a runtime owner from the current best tab,
 * which may have changed since the START.
 */
export function planAuthLossStop(work: AuthLossWorkState): AuthLossStopPlan {
  return {
    stopAutoSolve: work.isAutoSolving,
    autoSolveTabId: work.autoSolveTabId,
    cancelFullPage: work.isFullPageScan,
    fullPageTabId: work.fullPageTabId,
  };
}
