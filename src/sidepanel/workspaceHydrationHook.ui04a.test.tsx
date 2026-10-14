import React, { useCallback, useReducer } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateOrigin, CandidateWorkspaceSnapshot } from "@/shared/types";
import { createCandidateWorkspaceRuntime } from "@/content/candidateWorkspaceRuntime";
import { markProtectedWorkOwner, readProtectedWorkOwners, terminateRecordedProtectedWork } from "@/shared/auth/protectedWorkOwner";
import { useCandidateWorkspaceHydration } from "./useCandidateWorkspaceHydration";
import type { WorkspaceHydrationStatus } from "./workspaceHydration";
import { initialSidePanelAppState, sidePanelAppReducer } from "./sidepanelAppState";
import { CandidateEmptyState } from "./candidateWorkspaceSections";
import { deriveSidePanelWorkspaceStatus } from "./sidePanelWorkspaceState";

const listeners = new Set<(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) => void>();
const sessionListeners = new Set<() => void>();
const tabActivatedListeners = new Set<(info: { tabId: number }) => void>();
const sessionStore: Record<string, unknown> = {};
let auth = "authenticated";
let runtime: ReturnType<typeof createCandidateWorkspaceRuntime>;
let response: Promise<unknown> | null = null;
const order: string[] = [];
const url = "https://quiz.example/exam";
const session = { getState: () => ({ status: auth }), subscribe: (fn: () => void) => { sessionListeners.add(fn); return () => { sessionListeners.delete(fn); }; } };
const publishLive = (message: unknown) => { for (const listener of listeners) listener(message as Record<string, unknown>, { tab: { id: 7, url }, frameId: 0 } as chrome.runtime.MessageSender); };

beforeEach(() => {
  listeners.clear(); sessionListeners.clear(); tabActivatedListeners.clear(); order.length = 0; auth = "authenticated"; response = null;
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  runtime = createCandidateWorkspaceRuntime({ url: () => url, send: publishLive, runtimeInstanceId: "hook-runtime", runtimeGeneration: 1 });
  vi.stubGlobal("chrome", {
    runtime: { onMessage: { addListener: (fn: typeof publishLive) => { order.push("listener"); listeners.add(fn); }, removeListener: (fn: typeof publishLive) => listeners.delete(fn) } },
    tabs: { query: async () => { order.push("origin"); return [{ id: 7, url, active: true }]; }, get: async (id: number) => ({ id, url }),
      onActivated: { addListener: (fn: (info: { tabId: number }) => void) => tabActivatedListeners.add(fn),
        removeListener: (fn: (info: { tabId: number }) => void) => tabActivatedListeners.delete(fn) },
      sendMessage: (_tabId: number, message: { type: string; expectedUrl: string }, callback: (value: unknown) => void) => {
        order.push(message.type);
        if (response) void response.then(callback);
        else callback(runtime.snapshot(message.expectedUrl));
      } },
    storage: { session: {
      get: async () => ({ ...sessionStore }), set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
      remove: async (key: string) => { delete sessionStore[key]; },
    } },
  });
});

function Workspace() {
  const [state, dispatch] = useReducer(sidePanelAppReducer, initialSidePanelAppState);
  const publish = useCallback((status: WorkspaceHydrationStatus, snapshot?: CandidateWorkspaceSnapshot, origin?: CandidateOrigin) => dispatch({ type: "hydrateWorkspace", status, snapshot, origin }), []);
  useCandidateWorkspaceHydration(session, publish);
  const status = deriveSidePanelWorkspaceStatus({ ...state, authStatus: auth === "authenticated" ? "authenticated" : "unauthenticated", isAuthenticated: auth === "authenticated" });
  return <div><output data-testid="hydration">{state.hydrationStatus}</output><output data-testid="status">{status}</output><output data-testid="detection">{state.detectionPhase}</output><output data-testid="running">{String(state.isAutoSolving)}</output>
    {state.hydrationStatus === "ready" && state.candidates.length === 0 ? <CandidateEmptyState lang={state.uiLang} phase={state.detectionPhase} outcome={state.detectionOutcome} viewportEmpty={state.viewportEmpty} viewportEmptyDiagnostics={state.viewportEmptyDiagnostics} /> : null}
  </div>;
}

describe("UI-04A real hydration hook/reducer contract", () => {
  it("RC03D-R2B7 hook recovers after an eventless MV3 transport loss without granting work", async () => {
    let sends = 0;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.assign(chrome, { scripting: { executeScript: vi.fn(async () => { throw new Error("receiver asleep"); }) } });
    // The first *two* requests are receiver failures: one bootstrap retry
    // inside requestWorkspaceSnapshot. No content event is ever emitted.
    (chrome.tabs as unknown as { sendMessage: (tabId: number, message: { expectedUrl: string },
      callback: (response: unknown) => void) => void }).sendMessage = (_id, message, callback) => {
      sends++;
      if (sends <= 2) {
        Object.assign(chrome.runtime, { lastError: { message: "Could not establish connection. Receiving end does not exist." } });
        callback(undefined);
        Reflect.deleteProperty(chrome.runtime, "lastError");
      } else {
        callback(runtime.snapshot(message.expectedUrl));
      }
    };
    try {
      render(<Workspace />);
      await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("runtime_unavailable"));
      expect(sends).toBe(2);
      expect(screen.getByTestId("running")).toHaveTextContent("false");
      await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"), { timeout: 4500 });
      expect(sends).toBe(3);
      expect(screen.getByTestId("running")).toHaveTextContent("false");
    } finally {
      warning.mockRestore();
    }
  });

  it("UI04A-03 listener is installed before origin resolution and snapshot dispatch", async () => {
    runtime.setAutoSolveRunning(true);
    render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    expect(order.indexOf("listener")).toBeLessThan(order.indexOf("origin"));
    expect(order.indexOf("listener")).toBeLessThan(order.indexOf("GET_CANDIDATE_WORKSPACE_SNAPSHOT"));
    expect(screen.getByTestId("running")).toHaveTextContent("true");
    expect(screen.getByTestId("status")).toHaveTextContent("solving");
  });
  it("RC03D-C4 tab activation alone NEVER silently moves a live workspace owner", async () => {
    const view = render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    const before = order.filter(x => x === "GET_CANDIDATE_WORKSPACE_SNAPSHOT").length;
    // Existing autofill/scan remains bound to its captured origin even if
    // another Tab is activated: only explicit Retry may select a new source.
    expect(tabActivatedListeners.size).toBe(0);
    expect(screen.getByTestId("hydration")).toHaveTextContent("ready");
    expect(order.filter(x => x === "GET_CANDIDATE_WORKSPACE_SNAPSHOT").length).toBe(before);
    await act(async () => { auth = "unauthenticated"; for (const fn of sessionListeners) fn(); });
    expect(screen.getByTestId("hydration")).toHaveTextContent("idle");
    view.unmount();
  });

  it("UI04A-02 opening restores completed-empty through the real hook and reducer", async () => {
    runtime.beginDetection("viewport"); runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [] });
    render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    expect(screen.getByTestId("detection")).toHaveTextContent("completed");
  });
  it("RC03A-R7 hydrated completed-empty preserves numeric reasons, not a generic false no-question claim", async () => {
    runtime.beginDetection("viewport", "18aabcde-0ee2-4e98-8e12-48fdce879012");
    runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [], domDiagnostics: {
      probedElements: 8, acceptedCandidates: 0,
      rejected: { geometry: 1, text: 0, controls: 0, navigation: 0, signal: 1, confidence: 0, completeness: 6, grouped: 0, fragment: 0, duplicate: 0 },
    } });
    render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    expect(screen.getByText(/进行了 8 次顶层 DOM/)).toBeInTheDocument();
    expect(screen.getByText(/题目完整性（6 次）/)).toBeInTheDocument();
    expect(screen.queryByText(/页面没有题目/)).toBeNull();
    expect(screen.getByTestId("detection")).toHaveTextContent("completed");
  });

  it("RC03A-R7 zero DOM probes and route reset keep independent, fail-closed user feedback", async () => {
    runtime.beginDetection("viewport");
    runtime.observe({ type: "AUTO_DETECT_RESULT_READY", candidates: [], domDiagnostics: {
      probedElements: 0, acceptedCandidates: 0,
      rejected: { geometry: 0, text: 0, controls: 0, navigation: 0, signal: 0, confidence: 0, completeness: 0, grouped: 0, fragment: 0, duplicate: 0 },
    } });
    render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    expect(screen.getByText(/未探测到顶层 DOM/)).toBeInTheDocument();
    await act(async () => { runtime.resetDetection(); });
    await waitFor(() => expect(screen.getByTestId("detection")).toHaveTextContent("never_started"));
    expect(screen.getByText(/先用“当前屏”/)).toBeInTheDocument();
    expect(screen.queryByText(/未探测到顶层 DOM/)).toBeNull();
  });

  it("RC03A-R8 content-owned viewport failure remains visible after Side Panel hydration", async () => {
    const ownRequest = "18aabcde-0ee2-4e98-8e12-48fdce879012";
    runtime.beginDetection("viewport", ownRequest);
    expect(runtime.failViewportDetection(ownRequest)).toBe(true);
    expect(runtime.snapshot(url).snapshot?.detection).toEqual({
      phase: "failed", mode: "viewport", requestId: ownRequest,
    });
    render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    expect(screen.getByTestId("detection")).toHaveTextContent("failed");
    expect(screen.getByText(/扫描过程中发生错误/)).toBeInTheDocument();
    expect(screen.queryByText(/先用“当前屏”/)).toBeNull();
    await act(async () => { runtime.resetDetection(); });
    await waitFor(() => expect(screen.getByTestId("detection")).toHaveTextContent("never_started"));
    expect(screen.getByText(/先用“当前屏”/)).toBeInTheDocument();
    expect(screen.queryByText(/扫描过程中发生错误/)).toBeNull();
  });

  it("UI04A-10 pending snapshot shows runtime syncing, not authentication-server-unavailable or Ready", () => {
    response = new Promise(() => undefined);
    render(<Workspace />);
    expect(screen.getByTestId("status")).toHaveTextContent("syncing_runtime");
  });
  it("UI04A-12/18 snapshot cannot alter multi-tab owners; auth-loss STOP/CANCEL still targets every owner", async () => {
    await markProtectedWorkOwner("autoSolve", 7); await markProtectedWorkOwner("autoSolve", 8); await markProtectedWorkOwner("fullPage", 9);
    const before = await readProtectedWorkOwners();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByTestId("hydration")).toHaveTextContent("ready"));
    expect(await readProtectedWorkOwners()).toEqual(before);
    await act(async () => { auth = "unauthenticated"; for (const fn of sessionListeners) fn(); });
    const send = vi.fn(async () => undefined);
    await terminateRecordedProtectedWork(send);
    expect(send.mock.calls).toEqual([[7, { type: "STOP_AUTO_SOLVE_ALL" }], [8, { type: "STOP_AUTO_SOLVE_ALL" }], [9, { type: "FULL_PAGE_DETECT_CANCELLED" }]]);
    expect(screen.getByTestId("hydration")).toHaveTextContent("idle");
  });
  it("UI04A-11 before server authentication no snapshot dispatch or projection is permitted", async () => {
    auth = "unauthenticated";
    runtime.setAutoSolveRunning(true);
    render(<Workspace />);
    await act(async () => { runtime.setAutoSolveRunning(true); });
    expect(order).toEqual(["listener"]);
    expect(screen.getByTestId("status")).toHaveTextContent("signed_out");
    expect(screen.getByTestId("running")).toHaveTextContent("false");
  });
});
