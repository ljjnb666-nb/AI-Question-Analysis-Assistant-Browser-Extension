import { describe, expect, it } from "vitest";
import { planAuthLossStop } from "./sidepanelAuthLoss";
import { initialSidePanelAppState, type SidePanelAppState } from "./sidepanelAppState";

function stateWith(overrides: Partial<SidePanelAppState>): SidePanelAppState {
  return { ...initialSidePanelAppState, ...overrides };
}

describe("planAuthLossStop", () => {
  it("AUTH_UI_24_PLAN requests STOP only while auto solve is running", () => {
    expect(planAuthLossStop(stateWith({ isAutoSolving: true }))).toEqual({
      stopAutoSolve: true,
      cancelFullPage: false,
    });
  });

  it("AUTH_UI_24_PLAN requests CANCEL only while a full-page scan is running", () => {
    expect(planAuthLossStop(stateWith({ isFullPageScan: true }))).toEqual({
      stopAutoSolve: false,
      cancelFullPage: true,
    });
  });

  it("AUTH_UI_24_PLAN requests both terminations when both workflows run", () => {
    expect(
      planAuthLossStop(stateWith({ isAutoSolving: true, isFullPageScan: true })),
    ).toEqual({ stopAutoSolve: true, cancelFullPage: true });
  });

  it("AUTH_UI_24_PLAN plans nothing when no protected workflow is active", () => {
    expect(planAuthLossStop(initialSidePanelAppState)).toEqual({
      stopAutoSolve: false,
      cancelFullPage: false,
    });
  });

  it("AUTH_UI_24_PLAN ignores transient busy flags that have no runtime loop", () => {
    // Batch parse / fill / retries have no content-script loop to stop; the
    // watchdog only terminates the two long-running content workflows.
    expect(
      planAuthLossStop(
        stateWith({ isBatchParsing: true, isBatchFilling: true, isRetryingRisky: true, isDetecting: true }),
      ),
    ).toEqual({ stopAutoSolve: false, cancelFullPage: false });
  });
});
